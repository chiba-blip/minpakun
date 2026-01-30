import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * シミュレーションジョブ
 * 新規リスティングに対して3シナリオのシミュレーションを実行
 */
// デフォルトのコスト設定
const DEFAULT_COST_CONFIG = {
  cleaning_fee_per_reservation: 10000,
  ota_fee_rate: 15,
  management_fee_rate: 20,
  other_cost_rate: 5,
};

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

      const property = listing.properties as {
        id: string;
        building_area: number | null;
        land_area: number | null;
        rooms: number | null;
        property_type: string | null;
        city: string | null;
      };

      if (!property) continue;

      try {
        // シミュレーション実行（ヒューリスティクス）
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

const DAYS_IN_MONTH: Record<number, number> = {
  1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30,
  7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};

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

  const isApartment = property.property_type?.includes('集合');
  const rooms = property.rooms || (isApartment ? 6 : 1);
  const bedrooms = isApartment ? rooms : Math.max(1, Math.floor((property.building_area || 100) / 30));
  
  const bedroomMultiplier = 1 + (bedrooms - 1) * 0.3;
  const baseAdr = Math.round(areaDefaults.adr * bedroomMultiplier);
  const baseOccupancy = areaDefaults.occupancy;
  const avgStay = 2.2;

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
      const revenue = booked_nights * nightly_rate * rooms;

      monthlies.push({
        month,
        nightly_rate,
        occupancy_rate: Math.round(occupancy_rate * 100) / 100,
        booked_nights,
        reservations,
        avg_stay: avgStay,
        revenue,
      });

      annualRevenue += revenue;
      totalReservations += reservations;
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
        rooms,
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
