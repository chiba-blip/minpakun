/**
 * ヒューリスティクスベースのシミュレーション
 * AirROI/AirDNAが使えない場合のフォールバック
 */
import type { 
  PropertyInput, 
  SimulationResult, 
  MonthlyData, 
  Scenario,
  SimulationAssumptions,
} from './types.mts';
import { DAYS_IN_MONTH } from './types.mts';

/**
 * エリアごとの基準値（北海道）
 * 実績データから調整可能
 */
const AREA_DEFAULTS: Record<string, { adr: number; occupancy: number }> = {
  // ニセコ・倶知安はスキーシーズンが高い
  'ニセコ町': { adr: 35000, occupancy: 55 },
  '倶知安町': { adr: 30000, occupancy: 50 },
  // 小樽・余市は観光需要
  '小樽市': { adr: 15000, occupancy: 45 },
  '余市町': { adr: 12000, occupancy: 40 },
  // 札幌市はビジネス＋観光
  '札幌市': { adr: 12000, occupancy: 55 },
  // デフォルト
  'default': { adr: 10000, occupancy: 40 },
};

/**
 * 季節変動係数（月ごと）
 * 北海道は冬が高く、春秋が低い
 */
const SEASONALITY: Record<number, { adr: number; occupancy: number }> = {
  1: { adr: 1.3, occupancy: 1.2 },   // 正月・スキー
  2: { adr: 1.4, occupancy: 1.3 },   // スキーピーク
  3: { adr: 1.1, occupancy: 1.1 },
  4: { adr: 0.9, occupancy: 0.8 },   // オフシーズン
  5: { adr: 0.9, occupancy: 0.9 },
  6: { adr: 0.85, occupancy: 0.8 },  // 梅雨
  7: { adr: 1.1, occupancy: 1.1 },   // 夏休み
  8: { adr: 1.2, occupancy: 1.2 },   // お盆
  9: { adr: 0.95, occupancy: 0.9 },
  10: { adr: 1.0, occupancy: 0.95 }, // 紅葉
  11: { adr: 0.9, occupancy: 0.85 },
  12: { adr: 1.2, occupancy: 1.1 },  // 年末・スキー
};

/**
 * ベッドルーム数を推定
 */
export function estimateBedrooms(property: PropertyInput): number {
  const { building_area, rooms, property_type } = property;

  // 一棟集合住宅の場合
  if (property_type === '一棟集合住宅' && rooms && rooms > 1) {
    // 各部屋を1ベッドルームとして計算
    return rooms;
  }

  // 戸建ての場合、建物面積から推定
  if (building_area) {
    // 30㎡あたり1ベッドルーム（仮）
    return Math.max(1, Math.floor(building_area / 30));
  }

  return 2; // デフォルト
}

/**
 * 定員数を推定
 */
export function estimateGuests(bedrooms: number): number {
  // 1ベッドルームあたり2人 + 1人（ソファベッド等）
  return bedrooms * 2 + 1;
}

/**
 * ヒューリスティクスでシミュレーション実行
 */
export function runHeuristicsSimulation(
  property: PropertyInput,
  costConfig?: SimulationAssumptions['cost_config']
): SimulationResult[] {
  const city = property.city || 'default';
  const areaDefaults = AREA_DEFAULTS[city] || AREA_DEFAULTS['default'];
  
  const bedrooms = estimateBedrooms(property);
  const guests = estimateGuests(bedrooms);
  
  // ベッドルーム数に応じてADRを調整
  const bedroomMultiplier = 1 + (bedrooms - 1) * 0.3;
  const baseAdr = Math.round(areaDefaults.adr * bedroomMultiplier);
  const baseOccupancy = areaDefaults.occupancy;
  const avgStay = 2.2;

  const scenarios: Scenario[] = ['NEGATIVE', 'NEUTRAL', 'POSITIVE'];
  const results: SimulationResult[] = [];

  for (const scenario of scenarios) {
    const adjustment = scenario === 'NEGATIVE' ? -10 : scenario === 'POSITIVE' ? 10 : 0;
    const adjustmentMultiplier = 1 + adjustment / 100;

    const monthlies: MonthlyData[] = [];
    let annualRevenue = 0;

    for (let month = 1; month <= 12; month++) {
      const season = SEASONALITY[month];
      
      const nightly_rate = Math.round(baseAdr * season.adr * adjustmentMultiplier);
      const occupancy_rate = Math.min(100, baseOccupancy * season.occupancy * adjustmentMultiplier);
      
      const daysInMonth = DAYS_IN_MONTH[month];
      const booked_nights = Math.round(daysInMonth * (occupancy_rate / 100));
      const reservations = Math.max(1, Math.round(booked_nights / avgStay));
      const revenue = booked_nights * nightly_rate;

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
    }

    // コスト計算
    let annualProfit: number | null = null;
    if (costConfig) {
      const totalReservations = monthlies.reduce((sum, m) => sum + m.reservations, 0);
      const cleaningCost = totalReservations * costConfig.cleaning_fee_per_reservation;
      const otaFee = annualRevenue * (costConfig.ota_fee_rate / 100);
      const managementFee = annualRevenue * (costConfig.management_fee_rate / 100);
      const otherCost = annualRevenue * (costConfig.other_cost_rate / 100);
      
      annualProfit = annualRevenue - cleaningCost - otaFee - managementFee - otherCost;
    }

    results.push({
      scenario,
      monthlies,
      annual_revenue: annualRevenue,
      annual_profit: annualProfit,
      assumptions: {
        bedrooms,
        guests,
        base_adr: baseAdr,
        base_occupancy: baseOccupancy,
        avg_stay: avgStay,
        data_source: 'heuristics',
        scenario_adjustment: adjustment,
        cost_config: costConfig,
      },
    });
  }

  return results;
}
