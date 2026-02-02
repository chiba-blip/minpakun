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

// AirROI APIが使用可能かチェック
const hasAirROIKey = !!process.env.AIRROI_API_KEY;

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();

  const results = {
    processed: 0,
    simulated: 0,
    errors: [] as string[],
    message: '',
  };

  try {
    // コスト設定を取得
    const { data: costConfig } = await supabase
      .from('cost_configs')
      .select('*')
      .limit(1)
      .single();

    const costs = costConfig || DEFAULT_COST_CONFIG;

    // シミュレーション未実行のリスティングを取得
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
          city
        )
      `)
      .not('property_id', 'is', null)
      .order('scraped_at', { ascending: false })
      .limit(100);

    if (listingsError) {
      throw new Error(`Failed to fetch listings: ${listingsError.message}`);
    }

    if (!listings || listings.length === 0) {
      results.message = 'シミュレーション対象の物件がありません。先にスクレイプを実行してください。';
      return NextResponse.json(results);
    }

    for (const listing of listings) {
      results.processed++;

      // 既存シミュレーションをチェック
      const { data: existingSim } = await supabase
        .from('simulations')
        .select('id')
        .eq('listing_id', listing.id)
        .limit(1);

      if (existingSim && existingSim.length > 0) {
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const property = listing.properties as any;

      if (!property) continue;

      try {
        let simResults: SimulationResult[];

        // AirROI APIが使用可能な場合は優先使用
        if (hasAirROIKey && property.address_raw) {
          try {
            simResults = await runAirROISimulation(property, costs);
            console.log(`[simulate] AirROI used for property ${property.id}`);
          } catch (airroiError) {
            console.warn(`[simulate] AirROI failed, falling back to heuristics: ${airroiError}`);
            simResults = runHeuristicsSimulation(property, costs);
          }
        } else {
          // ヒューリスティクスにフォールバック
          simResults = runHeuristicsSimulation(property, costs);
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

    results.message = `${results.simulated}件のシミュレーションを完了しました`;
    return NextResponse.json(results);
  } catch (error) {
    console.error('Simulate job failed:', error);
    return NextResponse.json(
      { error: String(error), ...results },
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

function runHeuristicsSimulation(
  property: {
    building_area: number | null;
    rooms: number | null;
    property_type: string | null;
    city: string | null;
  },
  costs: CostConfig
): SimulationResult[] {
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

  for (const scenario of scenarios) {
    const adjustment = scenario === 'NEGATIVE' ? -10 : scenario === 'POSITIVE' ? 10 : 0;
    const adjustmentMultiplier = 1 + adjustment / 100;

    const monthlies: MonthlyData[] = [];
    let annualRevenue = 0;
    let totalReservations = 0;

    for (let month = 1; month <= 12; month++) {
      const season = SEASONALITY[month];
      
      const nightly_rate = Math.round(baseAdr * season.adr * adjustmentMultiplier);
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
  costs: CostConfig
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

  // 2. 建物面積から bedrooms/guests を推定
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

  // 3. AirROI /listings/comparables で類似物件を取得
  const airroiClient = new AirROIClient();
  const comparablesResponse = await airroiClient.getComparables({
    lat,
    lng,
    bedrooms,
    guests,
    radius_km: 10,
    limit: 30,
  });

  if (comparablesResponse.comparables.length === 0) {
    throw new Error('類似物件が見つかりませんでした');
  }

  // 4. 上位20件の listing_id で月次メトリクスを取得
  const topComps = comparablesResponse.comparables.slice(0, 20);
  const listingIds = topComps.map(c => c.listing_id);
  
  const metricsResponses = await airroiClient.getMetricsBulk(listingIds, 12);

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
      const revenue = Math.round(baseRevenue * adjustmentMultiplier);
      
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
        : Math.round(monthly.avgAdr * adjustmentMultiplier);

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
