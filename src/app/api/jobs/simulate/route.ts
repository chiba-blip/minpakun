import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { geocodeAddress } from '@/lib/geo';
import { 
  AirROIClient, 
  estimateBedroomsAndGuests, 
  aggregateMonthlyMetrics,
  calculateBookingMetrics,
  DAYS_IN_MONTH,
} from '@/lib/airroi';

// ---------------------------------------------------------------------------
// 物件特性による補正（簡易）
// ---------------------------------------------------------------------------
const LARGE_AREA_THRESHOLD_M2 = 80; // 「面積が大きい」判定（1戸あたり）
const LARGE_AREA_MULTIPLIER = 1.05; // +5%

function calculatePropertyRevenueAdjustment(params: {
  areaPerUnit: number;
}): { multiplier: number; reasons: string[] } {
  const reasons: string[] = [];
  let multiplier = 1;

  // 面積が大きい → +5%
  if (Number.isFinite(params.areaPerUnit) && params.areaPerUnit >= LARGE_AREA_THRESHOLD_M2) {
    multiplier *= LARGE_AREA_MULTIPLIER;
    reasons.push(`面積が大きい(+5%): ${Math.round(params.areaPerUnit)}㎡/戸`);
  }
  return { multiplier, reasons };
}

/**
 * シミュレーションジョブ
 * AirROI APIで類似物件データを取得し、3シナリオのシミュレーションを実行
 */
// デフォルトのコスト設定
const DEFAULT_COST_CONFIG = {
  cleaning_fee_per_reservation: 10000,
  ota_fee_rate: 15,
  management_fee_rate: 20,
  other_cost_rate: 5,
};

// 大量処理前提: ページングしつつ1回の実行は時間内で打ち切る
// Netlify Proは26秒タイムアウトなので24秒に設定
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_TIME_BUDGET_MS = 24000;
const MAX_COMPARABLES_FOR_METRICS = 3;

// AirROI APIが使用可能かチェック
const hasAirROIKey = !!process.env.AIRROI_API_KEY;

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { searchParams } = new URL(request.url);
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
  const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const timeBudgetMs = Math.min(25000, Math.max(1000, parseInt(searchParams.get('timeBudgetMs') || String(DEFAULT_TIME_BUDGET_MS), 10) || DEFAULT_TIME_BUDGET_MS));
  const startedAt = Date.now();

  const results = {
    processed: 0,
    simulated: 0,
    skipped: {
      already_simulated: 0,
      no_api_key: 0,
      no_address: 0,
      airroi_failed: 0,
    },
    errors: [] as string[],
    message: '',
    has_more: false,
    next_offset: offset,
  };

  try {
    // コスト設定を取得
    const { data: costConfig } = await supabase
      .from('cost_configs')
      .select('*')
      .limit(1)
      .single();

    const costs = costConfig || DEFAULT_COST_CONFIG;

    // リスティングをページング取得（大量件数前提）
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select(`
        id,
        property_id,
        price,
        properties (
          id,
          building_area,
          land_area,
          rooms,
          property_type,
          city,
          address_raw
        )
      `)
      .not('property_id', 'is', null)
      .order('scraped_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (listingsError) {
      throw new Error(`Failed to fetch listings: ${listingsError.message}`);
    }

    if (!listings || listings.length === 0) {
      results.message = 'シミュレーション対象の物件がありません。先にスクレイプを実行してください。';
      return NextResponse.json(results);
    }

    for (const listing of listings) {
      results.processed++;
      results.next_offset = offset + results.processed;

      // タイムアウト回避: 時間内で打ち切り（次回offsetから続き）
      if (Date.now() - startedAt > timeBudgetMs) {
        break;
      }

      // 既存シミュレーションをチェック
      const { data: existingSim } = await supabase
        .from('simulations')
        .select('id')
        .eq('listing_id', listing.id)
        .limit(1);

      if (existingSim && existingSim.length > 0) {
        results.skipped.already_simulated++;
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const property = listing.properties as any;

      if (!property) continue;

      try {
        let simResults: SimulationResult[];

        console.log(`[simulate] Processing property ${property.id}, address_raw: ${property.address_raw}, hasAirROIKey: ${hasAirROIKey}`);

        // AirROI APIのみ使用（ヒューリスティクスへのフォールバックなし）
        if (!hasAirROIKey) {
          console.log(`[simulate] Skipping property ${property.id}: AirROI API key not configured`);
          results.skipped.no_api_key++;
          continue;
        }
        
        if (!property.address_raw) {
          console.log(`[simulate] Skipping property ${property.id}: No address available`);
          results.skipped.no_address++;
          continue;
        }

        try {
          simResults = await runAirROISimulation(property, costs, supabase);
          console.log(`[simulate] AirROI successfully used for property ${property.id}`);
        } catch (airroiError) {
          const errorMessage = airroiError instanceof Error ? airroiError.message : String(airroiError);
          console.error(`[simulate] AirROI failed for property ${property.id}: ${errorMessage}`);
          results.skipped.airroi_failed++;
          results.errors.push(`AirROI failed: ${errorMessage.substring(0, 100)}`);
          continue; // スキップ（ヒューリスティクスは使わない）
        }

        for (const sim of simResults) {
          const { data: insertedSim, error: simError } = await supabase
            .from('simulations')
            .insert({
              property_id: property.id,
              listing_id: listing.id,
              scenario: sim.scenario,
              annual_revenue: sim.annual_revenue,
              annual_profit: sim.annual_profit,
              assumptions: sim.assumptions,
            })
            .select('id')
            .single();

          if (simError) {
            results.errors.push(`シミュレーション保存失敗: ${simError.message}`);
            continue;
          }

          // 月次データ保存
          const monthlyInserts = sim.monthlies.map((m: MonthlyData) => ({
            simulation_id: insertedSim.id,
            month: m.month,
            nightly_rate: m.nightly_rate,
            occupancy_rate: m.occupancy_rate,
            booked_nights: m.booked_nights,
            reservations: m.reservations,
            avg_stay: m.avg_stay,
            revenue: m.revenue,
          }));

          await supabase.from('simulation_monthlies').insert(monthlyInserts);
        }

        results.simulated++;
      } catch (error) {
        results.errors.push(`エラー: ${error}`);
      }
    }

    // まだ処理すべきリスティングがあるかどうか
    // - リスティングがpageSize分あった場合は次のページがある可能性
    // - タイムアウトで途中で抜けた場合も続きがある
    const timedOut = Date.now() - startedAt > timeBudgetMs;
    results.has_more = listings.length === pageSize || (timedOut && results.processed < listings.length);
    results.message = `${results.simulated}件のシミュレーションを完了しました（offset=${offset}, processed=${results.processed}, pageSize=${pageSize}, timedOut=${timedOut}）`;
    return NextResponse.json(results);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('Simulate job failed:', errorMessage, errorStack);
    return NextResponse.json(
      { 
        error: errorMessage,
        stack: errorStack,
        ...results 
      },
      { status: 500 }
    );
  }
}

interface MonthlyData {
  month: number;
  nightly_rate: number;
  occupancy_rate: number;
  booked_nights: number;
  reservations: number;
  avg_stay: number;
  revenue: number;
}

interface SimulationResult {
  scenario: string;
  annual_revenue: number;
  annual_profit: number | null;
  assumptions: Record<string, unknown>;
  monthlies: MonthlyData[];
}

// DAYS_IN_MONTH は airroi.ts からインポート

const AREA_DEFAULTS: Record<string, { adr: number; occupancy: number }> = {
  'ニセコ町': { adr: 35000, occupancy: 55 },
  '倶知安町': { adr: 30000, occupancy: 50 },
  '小樽市': { adr: 15000, occupancy: 45 },
  '余市町': { adr: 12000, occupancy: 40 },
  '札幌市': { adr: 12000, occupancy: 55 },
  '札幌市中央区': { adr: 14000, occupancy: 60 },
  '札幌市北区': { adr: 11000, occupancy: 50 },
  'default': { adr: 10000, occupancy: 40 },
};

const SEASONALITY: Record<number, { adr: number; occupancy: number }> = {
  1: { adr: 1.3, occupancy: 1.2 },
  2: { adr: 1.4, occupancy: 1.3 },
  3: { adr: 1.1, occupancy: 1.1 },
  4: { adr: 0.9, occupancy: 0.8 },
  5: { adr: 0.9, occupancy: 0.9 },
  6: { adr: 0.85, occupancy: 0.8 },
  7: { adr: 1.1, occupancy: 1.1 },
  8: { adr: 1.2, occupancy: 1.2 },
  9: { adr: 0.95, occupancy: 0.9 },
  10: { adr: 1.0, occupancy: 0.95 },
  11: { adr: 0.9, occupancy: 0.85 },
  12: { adr: 1.2, occupancy: 1.1 },
};

interface CostConfig {
  cleaning_fee_per_reservation: number;
  ota_fee_rate: number;
  management_fee_rate: number;
  other_cost_rate: number;
}

async function runHeuristicsSimulation(
  property: {
    address_raw?: string | null;
    building_area: number | null;
    rooms: number | null;
    property_type: string | null;
    city: string | null;
  },
  costs: CostConfig
): Promise<SimulationResult[]> {
  const city = property.city || 'default';
  const areaKey = Object.keys(AREA_DEFAULTS).find(k => city.includes(k)) || 'default';
  const areaDefaults = AREA_DEFAULTS[areaKey];

  // 集合住宅判定（アパート、マンション、集合住宅）
  const isApartment = property.property_type?.includes('集合') ||
                      property.property_type?.includes('アパート') ||
                      property.property_type?.includes('マンション');
  
  // 戸数: 集合住宅の場合のみ rooms を戸数として使用、一戸建ては常に1
  const units = isApartment ? (property.rooms || 6) : 1;
  
  // 1戸あたりのbedrooms推定（建物面積から）
  const buildingArea = property.building_area || 80;
  const areaPerUnit = isApartment && units > 1 ? buildingArea / units : buildingArea;
  const bedrooms = Math.max(1, Math.ceil(areaPerUnit / 40));
  
  const bedroomMultiplier = 1 + (bedrooms - 1) * 0.3;
  const baseAdr = Math.round(areaDefaults.adr * bedroomMultiplier);
  const baseOccupancy = areaDefaults.occupancy;
  const avgStay = 2.5;

  const scenarios = ['NEGATIVE', 'NEUTRAL', 'POSITIVE'];
  const results: SimulationResult[] = [];

  // 物件特性補正（面積のみ）
  const adj = calculatePropertyRevenueAdjustment({ areaPerUnit });
  const propertyMultiplier = adj.multiplier;
  const propertyAdjustmentReasons = adj.reasons;

  for (const scenario of scenarios) {
    const adjustment = scenario === 'NEGATIVE' ? -10 : scenario === 'POSITIVE' ? 10 : 0;
    const adjustmentMultiplier = 1 + adjustment / 100;

    const monthlies: MonthlyData[] = [];
    let annualRevenue = 0;
    let totalReservations = 0;

    for (let month = 1; month <= 12; month++) {
      const season = SEASONALITY[month];
      
      // 物件補正は主に単価（ADR）側に反映
      const nightly_rate = Math.round(baseAdr * season.adr * adjustmentMultiplier * propertyMultiplier);
      const occupancy_rate = Math.min(100, baseOccupancy * season.occupancy * adjustmentMultiplier);
      
      const daysInMonth = DAYS_IN_MONTH[month];
      const booked_nights = Math.round(daysInMonth * (occupancy_rate / 100));
      const reservations = Math.max(1, Math.round(booked_nights / avgStay));
      // 1戸あたりの売上を計算し、戸数を掛ける（一戸建ては units=1）
      const revenuePerUnit = booked_nights * nightly_rate;
      const revenue = revenuePerUnit * units;

      // 集合住宅の場合は予約数も戸数分
      const totalReservationsMonth = reservations * units;

      monthlies.push({
        month,
        nightly_rate,
        occupancy_rate: Math.round(occupancy_rate * 100) / 100,
        booked_nights,
        reservations: totalReservationsMonth,
        avg_stay: avgStay,
        revenue,
      });

      annualRevenue += revenue;
      totalReservations += totalReservationsMonth;
    }

    // コスト計算
    const cleaningCost = totalReservations * costs.cleaning_fee_per_reservation;
    const otaFee = Math.round(annualRevenue * (costs.ota_fee_rate / 100));
    const managementFee = Math.round(annualRevenue * (costs.management_fee_rate / 100));
    const otherCost = Math.round(annualRevenue * (costs.other_cost_rate / 100));
    const totalCost = cleaningCost + otaFee + managementFee + otherCost;
    
    // 利益 = 売上 - コスト
    const annualProfit = annualRevenue - totalCost;

    results.push({
      scenario,
      monthlies,
      annual_revenue: annualRevenue,
      annual_profit: annualProfit,
      assumptions: {
        bedrooms,
        units,
        area_per_unit: areaPerUnit,
        base_adr: baseAdr,
        base_occupancy: baseOccupancy,
        avg_stay: avgStay,
        data_source: 'heuristics',
        scenario_adjustment: adjustment,
        revenue_adjustment_multiplier: propertyMultiplier,
        revenue_adjustment_reasons: propertyAdjustmentReasons,
        costs: {
          cleaning_fee_per_reservation: costs.cleaning_fee_per_reservation,
          ota_fee_rate: costs.ota_fee_rate,
          management_fee_rate: costs.management_fee_rate,
          other_cost_rate: costs.other_cost_rate,
          cleaning_cost: cleaningCost,
          ota_fee: otaFee,
          management_fee: managementFee,
          other_cost: otherCost,
          total_cost: totalCost,
        },
      },
    });
  }

  return results;
}

/**
 * AirROI APIを使用したシミュレーション
 * @param supabaseClient キャッシュ用Supabaseクライアント（オプション）
 */
async function runAirROISimulation(
  property: {
    id?: string;
    address_raw: string | null;
    building_area: number | null;
    rooms: number | null;
    property_type: string | null;
    city: string | null;
  },
  costs: CostConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: any
): Promise<SimulationResult[]> {
  if (!property.address_raw) {
    throw new Error('住所がありません');
  }

  // 1. ジオコードで lat/lng を取得
  const geoResult = await geocodeAddress(property.address_raw);
  if (!geoResult) {
    throw new Error('ジオコーディングに失敗しました');
  }
  const { lat, lng } = geoResult;

  // 2. 建物面積から bedrooms/guests/baths を推定
  const isApartment = property.property_type?.includes('集合') || 
                      property.property_type?.includes('アパート') ||
                      property.property_type?.includes('マンション');
  const units = isApartment ? (property.rooms || 1) : 1;
  const buildingArea = property.building_area || 80;
  
  const { bedrooms, guests, areaPerUnit } = estimateBedroomsAndGuests(
    buildingArea,
    isApartment,
    units
  );
  
  // baths推定: bedrooms数に基づいて（1~2bedroomsは1、3以上は1.5~2）
  const baths = bedrooms <= 2 ? 1 : Math.min(bedrooms - 1, 3);

  // 2.5 物件特性補正（面積のみ）
  const propertyAdj = calculatePropertyRevenueAdjustment({ areaPerUnit });
  const propertyMultiplier = propertyAdj.multiplier;
  const propertyAdjustmentReasons = propertyAdj.reasons;

  // 3. AirROI /listings/comparables で類似物件を取得（キャッシュ対応）
  const airroiClient = new AirROIClient({ 
    apiKey: process.env.AIRROI_API_KEY || '',
    supabase: supabaseClient,
  });
  console.log(`[simulate] Calling AirROI with lat=${lat}, lng=${lng}, bedrooms=${bedrooms}, baths=${baths}, guests=${guests}`);
  
  const comparablesResponse = await airroiClient.getComparables({
    lat,
    lng,
    bedrooms,
    baths,
    guests,
  });

  if (!comparablesResponse.listings || comparablesResponse.listings.length === 0) {
    throw new Error('類似物件が見つかりませんでした');
  }
  
  console.log(`[simulate] Found ${comparablesResponse.listings.length} comparable listings`);

  // 4. 上位N件の listing_id で月次メトリクスを取得（時間短縮）
  const topComps = comparablesResponse.listings.slice(0, MAX_COMPARABLES_FOR_METRICS);
  const listingIds = topComps.map(c => c.listing_info.listing_id);
  
  const metricsResponses = await airroiClient.getMetricsBulk(listingIds, 12);
  console.log(`[simulate] Got metrics for ${metricsResponses.length} listings`);

  // 5. 月次データを集約
  const aggregatedMonthly = aggregateMonthlyMetrics(metricsResponses);

  // 6. 3シナリオでシミュレーション結果を作成
  const scenarios = ['NEGATIVE', 'NEUTRAL', 'POSITIVE'];
  const results: SimulationResult[] = [];
  const avgStay = 2.5;

  for (const scenario of scenarios) {
    // シナリオ調整: NEGATIVE -10%, NEUTRAL 0%, POSITIVE +10%
    const adjustment = scenario === 'NEGATIVE' ? -10 : scenario === 'POSITIVE' ? 10 : 0;
    const adjustmentMultiplier = 1 + adjustment / 100;

    const monthlies: MonthlyData[] = [];
    let annualRevenue = 0;
    let totalReservations = 0;

    for (const monthly of aggregatedMonthly) {
      const daysInMonth = DAYS_IN_MONTH[monthly.month];
      
      // NEUTRAL は中央値ベース
      const baseRevenue = monthly.medianRevenue;
      const revenue = Math.round(baseRevenue * adjustmentMultiplier * propertyMultiplier);
      
      // 稼働率と稼働泊数
      const occupancy_rate = Math.round(monthly.avgOccupancy * adjustmentMultiplier * 10) / 10;
      const { bookedNights, reservations } = calculateBookingMetrics(
        occupancy_rate,
        daysInMonth,
        avgStay
      );

      // ADR（1泊あたり単価）
      const nightly_rate = bookedNights > 0 
        ? Math.round(revenue / bookedNights) 
        : Math.round(monthly.avgAdr * adjustmentMultiplier * propertyMultiplier);

      // 集合住宅の場合は戸数を掛ける
      const unitRevenue = revenue * units;

      monthlies.push({
        month: monthly.month,
        nightly_rate,
        occupancy_rate,
        booked_nights: bookedNights,
        reservations,
        avg_stay: avgStay,
        revenue: unitRevenue,
      });

      annualRevenue += unitRevenue;
      totalReservations += reservations * units;
    }

    // コスト計算
    const cleaningCost = totalReservations * costs.cleaning_fee_per_reservation;
    const otaFee = Math.round(annualRevenue * (costs.ota_fee_rate / 100));
    const managementFee = Math.round(annualRevenue * (costs.management_fee_rate / 100));
    const otherCost = Math.round(annualRevenue * (costs.other_cost_rate / 100));
    const totalCost = cleaningCost + otaFee + managementFee + otherCost;
    
    const annualProfit = annualRevenue - totalCost;

    results.push({
      scenario,
      monthlies,
      annual_revenue: annualRevenue,
      annual_profit: annualProfit,
      assumptions: {
        lat,
        lng,
        bedrooms,
        guests,
        units,
        area_per_unit: areaPerUnit,
        comparables_count: topComps.length,
        data_source: 'airroi',
        scenario_adjustment: adjustment,
        avg_stay: avgStay,
        revenue_adjustment_multiplier: propertyMultiplier,
        revenue_adjustment_reasons: propertyAdjustmentReasons,
        costs: {
          cleaning_fee_per_reservation: costs.cleaning_fee_per_reservation,
          ota_fee_rate: costs.ota_fee_rate,
          management_fee_rate: costs.management_fee_rate,
          other_cost_rate: costs.other_cost_rate,
          cleaning_cost: cleaningCost,
          ota_fee: otaFee,
          management_fee: managementFee,
          other_cost: otherCost,
          total_cost: totalCost,
        },
      },
    });
  }

  return results;
}
