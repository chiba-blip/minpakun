/**
 * 大量シミュレーション用 Background Function
 * 最大15分間バックグラウンドで実行可能
 * 
 * 呼び出し: POST /.netlify/functions/simulate-background
 */
import { getSupabaseAdmin } from './_shared/supabase.mts';
import { logInfo, logError } from './_shared/log.mts';
import type { Handler, HandlerEvent } from '@netlify/functions';

// 15分の制限に対して余裕を持たせる（14分）
const MAX_TIME_MS = 14 * 60 * 1000;
const BATCH_SIZE = 50;

// シナリオ調整値
const SCENARIO_ADJUSTMENTS: Record<string, number> = {
  'NEGATIVE': -10,
  'NEUTRAL': 0,
  'POSITIVE': 10,
};

// エリア別デフォルト値
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

// 月別の季節調整
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

// 月の日数
const DAYS_IN_MONTH: Record<number, number> = {
  1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30,
  7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};

// 面積補正
const LARGE_AREA_THRESHOLD_M2 = 80;
const LARGE_AREA_MULTIPLIER = 1.05;

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
  annual_profit: number;
  assumptions: Record<string, unknown>;
  monthlies: MonthlyData[];
}

interface CostConfig {
  cleaning_fee_per_reservation: number;
  ota_fee_rate: number;
  management_fee_rate: number;
  other_cost_rate: number;
}

const DEFAULT_COST_CONFIG: CostConfig = {
  cleaning_fee_per_reservation: 10000,
  ota_fee_rate: 15,
  management_fee_rate: 20,
  other_cost_rate: 5,
};

// 進捗状況テーブル更新
async function updateProgress(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  status: string,
  processed: number,
  total: number,
  message?: string
) {
  await supabase
    .from('simulation_progress')
    .upsert({
      id: 'current',
      status,
      processed,
      total,
      message: message || null,
      updated_at: new Date().toISOString(),
    });
}

// キャンセルチェック
async function isCancelled(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<boolean> {
  const { data } = await supabase
    .from('simulation_progress')
    .select('status')
    .eq('id', 'current')
    .eq('status', 'cancelled')
    .limit(1);
  return data && data.length > 0;
}

// ヒューリスティクスベースのシミュレーション
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

  const isApartment = property.property_type?.includes('集合') ||
                      property.property_type?.includes('アパート') ||
                      property.property_type?.includes('マンション');
  
  const units = isApartment ? (property.rooms || 6) : 1;
  const buildingArea = property.building_area || 80;
  const areaPerUnit = isApartment && units > 1 ? buildingArea / units : buildingArea;
  const bedrooms = Math.max(1, Math.ceil(areaPerUnit / 40));
  
  // 面積補正
  const propertyMultiplier = areaPerUnit >= LARGE_AREA_THRESHOLD_M2 ? LARGE_AREA_MULTIPLIER : 1;
  
  const bedroomMultiplier = 1 + (bedrooms - 1) * 0.3;
  const baseAdr = Math.round(areaDefaults.adr * bedroomMultiplier);
  const baseOccupancy = areaDefaults.occupancy;
  const avgStay = 2.5;

  const scenarios = ['NEGATIVE', 'NEUTRAL', 'POSITIVE'];
  const results: SimulationResult[] = [];

  for (const scenario of scenarios) {
    const adjustment = SCENARIO_ADJUSTMENTS[scenario];
    const adjustmentMultiplier = 1 + adjustment / 100;

    const monthlies: MonthlyData[] = [];
    let annualRevenue = 0;
    let totalReservations = 0;

    for (let month = 1; month <= 12; month++) {
      const season = SEASONALITY[month];
      
      const nightly_rate = Math.round(baseAdr * season.adr * adjustmentMultiplier * propertyMultiplier);
      const occupancy_rate = Math.min(100, baseOccupancy * season.occupancy * adjustmentMultiplier);
      
      const daysInMonth = DAYS_IN_MONTH[month];
      const booked_nights = Math.round(daysInMonth * (occupancy_rate / 100));
      const reservations = Math.max(1, Math.round(booked_nights / avgStay));
      const revenuePerUnit = booked_nights * nightly_rate;
      const revenue = revenuePerUnit * units;
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
        property_multiplier: propertyMultiplier,
      },
    });
  }

  return results;
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const supabase = getSupabaseAdmin();
  const startTime = Date.now();
  
  let processed = 0;
  let simulated = 0;
  let errors: string[] = [];

  try {
    logInfo('simulate-background', 'Starting background simulation');

    // コスト設定を取得
    const { data: costConfig } = await supabase
      .from('cost_configs')
      .select('*')
      .limit(1)
      .single();
    const costs = costConfig || DEFAULT_COST_CONFIG;

    // シミュレーション未実行のリスティングを取得
    const { count: totalCount } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .not('property_id', 'is', null);

    // 既存シミュレーションのlisting_idを取得
    const { data: existingSimListings } = await supabase
      .from('simulations')
      .select('listing_id');
    const existingListingIds = new Set(existingSimListings?.map(s => s.listing_id) || []);

    // 進捗を初期化
    await updateProgress(supabase, 'in_progress', 0, totalCount || 0, 'シミュレーション開始');

    let offset = 0;
    let hasMore = true;

    while (hasMore && Date.now() - startTime < MAX_TIME_MS) {
      // キャンセルチェック
      if (await isCancelled(supabase)) {
        logInfo('simulate-background', 'Cancelled by user');
        await updateProgress(supabase, 'cancelled', processed, totalCount || 0, 'ユーザーによりキャンセル');
        break;
      }

      // バッチ取得
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
        .range(offset, offset + BATCH_SIZE - 1);

      if (listingsError) {
        throw new Error(`Failed to fetch listings: ${listingsError.message}`);
      }

      if (!listings || listings.length === 0) {
        hasMore = false;
        break;
      }

      for (const listing of listings) {
        processed++;

        // タイムアウトチェック
        if (Date.now() - startTime > MAX_TIME_MS) {
          break;
        }

        // 既存シミュレーションをスキップ
        if (existingListingIds.has(listing.id)) {
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const property = listing.properties as any;
        if (!property) continue;

        try {
          const simResults = runHeuristicsSimulation(property, costs);

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
              errors.push(`Save error: ${simError.message}`);
              continue;
            }

            // 月次データ保存
            const monthlyInserts = sim.monthlies.map((m) => ({
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

          simulated++;
          existingListingIds.add(listing.id);

          // 10件ごとに進捗更新
          if (simulated % 10 === 0) {
            await updateProgress(
              supabase,
              'in_progress',
              processed,
              totalCount || 0,
              `${simulated}件完了`
            );
          }
        } catch (error) {
          errors.push(`Error: ${error}`);
        }
      }

      offset += BATCH_SIZE;
      hasMore = listings.length === BATCH_SIZE;
    }

    // 完了
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const message = `完了: ${simulated}件シミュレーション (${elapsed}秒)`;
    await updateProgress(supabase, 'completed', processed, totalCount || 0, message);
    
    logInfo('simulate-background', `Completed: ${simulated} simulations in ${elapsed}s`);

    return {
      statusCode: 202,
      body: JSON.stringify({
        success: true,
        simulated,
        processed,
        elapsed_seconds: elapsed,
        errors: errors.slice(0, 10),
      }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('simulate-background', `Failed: ${errorMessage}`);
    await updateProgress(supabase, 'error', processed, 0, errorMessage);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: errorMessage }),
    };
  }
};
