// みんぱくん DBテーブル型定義

export interface PortalSite {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  base_url: string | null;
  created_at: string;
}

export interface ScrapeConfig {
  id: string;
  enabled: boolean;
  areas: string[];
  property_types: string[];
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  normalized_address: string | null;
  city: string | null;
  address_raw: string | null;
  lat: number | null;
  lng: number | null;
  building_area: number | null;
  land_area: number | null;
  built_year: number | null;
  rooms: number | null;
  property_type: string | null;
  created_at: string;
}

export interface Listing {
  id: string;
  portal_site_id: string;
  property_id: string | null;
  url: string;
  title: string | null;
  price: number | null;
  external_id: string | null;
  scraped_at: string;
  raw: Record<string, unknown> | null;
}

export type SimulationScenario = 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE';

export interface Simulation {
  id: string;
  property_id: string;
  listing_id: string | null;
  scenario: SimulationScenario;
  annual_revenue: number | null;
  annual_profit: number | null;
  assumptions: Record<string, unknown> | null;
  created_at: string;
}

export interface SimulationMonthly {
  id: string;
  simulation_id: string;
  month: number;
  nightly_rate: number | null;
  occupancy_rate: number | null;
  booked_nights: number | null;
  reservations: number | null;
  avg_stay: number | null;
  revenue: number | null;
}

export interface CostConfig {
  id: string;
  cleaning_fee_per_reservation: number;
  ota_fee_rate: number;
  management_fee_rate: number;
  other_cost_rate: number;
  updated_at: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  enabled: boolean;
  multiple: number;
  areas: string[] | null;
  property_types: string[] | null;
  // 追加の検索条件
  price_min: number | null;
  price_max: number | null;
  walk_minutes_max: number | null;
  built_year_min: number | null;
  building_area_min: number | null;
  building_area_max: number | null;
  // コスト設定
  cleaning_fee_per_reservation: number;
  ota_fee_rate: number;
  management_fee_rate: number;
  other_cost_rate: number;
  created_at: string;
  updated_at: string;
}

export interface SlackConfig {
  id: string;
  enabled: boolean;
  webhook_url: string | null;
  created_at: string;
}

export interface NotificationLog {
  id: string;
  saved_search_id: string;
  listing_id: string;
  sent_at: string;
}

// 一覧表示用の拡張型
export interface PropertyWithSimulation extends Property {
  listing?: Listing;
  neutral_simulation?: Simulation;
  renovation_budget?: number; // annual_revenue * 10 - price
}

// CSV出力用
export interface MonthlyReportRow {
  month: number;
  scenario: SimulationScenario;
  nightly_rate: number;
  occupancy_rate: number;
  booked_nights: number;
  reservations: number;
  avg_stay: number;
  revenue: number;
}
