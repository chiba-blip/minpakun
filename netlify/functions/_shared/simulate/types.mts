/**
 * シミュレーション関連の型定義
 */

export type Scenario = 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE';

/**
 * 月次データ
 */
export interface MonthlyData {
  month: number; // 1-12
  nightly_rate: number;
  occupancy_rate: number; // 0-100
  booked_nights: number;
  reservations: number;
  avg_stay: number;
  revenue: number;
}

/**
 * シミュレーション結果
 */
export interface SimulationResult {
  scenario: Scenario;
  monthlies: MonthlyData[];
  annual_revenue: number;
  annual_profit: number | null;
  assumptions: SimulationAssumptions;
}

/**
 * シミュレーション前提条件
 */
export interface SimulationAssumptions {
  bedrooms: number;
  guests: number;
  base_adr: number;
  base_occupancy: number;
  avg_stay: number;
  data_source: 'airroi' | 'airdna' | 'heuristics';
  scenario_adjustment: number; // -10, 0, +10
  cost_config?: {
    cleaning_fee_per_reservation: number;
    ota_fee_rate: number;
    management_fee_rate: number;
    other_cost_rate: number;
  };
}

/**
 * 物件情報（シミュレーション入力用）
 */
export interface PropertyInput {
  building_area: number | null;
  land_area: number | null;
  rooms: number | null;
  property_type: string | null;
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
}

/**
 * 各月の日数
 */
export const DAYS_IN_MONTH: Record<number, number> = {
  1: 31,
  2: 28, // 平年
  3: 31,
  4: 30,
  5: 31,
  6: 30,
  7: 31,
  8: 31,
  9: 30,
  10: 31,
  11: 30,
  12: 31,
};
