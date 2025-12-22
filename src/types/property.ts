// 物件データ
export interface Property {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  address_text: string;
  lat: number | null;
  lng: number | null;
  capacity: number;
  layout_text: string;
  bedrooms: number | null;
  bathrooms: number | null;
  description: string | null;
  notes: string | null;
}

// 費用パラメータ
export interface CostProfile {
  id: string;
  property_id: string;
  created_at: string;
  ota_fee_rate: number;
  cleaning_cost_per_turnover: number;
  linen_cost_per_turnover: number;
  consumables_cost_per_night: number;
  utilities_cost_per_month: number;
  management_fee_rate: number;
  avg_stay_nights: number;
  other_fixed_cost_per_month: number;
  tax_rate: number;
}

// 最寄駅情報
export interface NearestStation {
  name: string;
  lat: number;
  lng: number;
  distance_m: number;
}

// 月次推定結果
export interface MonthlyEstimate {
  month: number; // 1-12
  days_in_month: number;
  gross_revenue: number;
  adr: number;
  occupancy_rate: number;
  occupied_nights: number;
  turnovers: number;
  ota_fee: number;
  management_fee: number;
  cleaning_cost: number;
  linen_cost: number;
  consumables_cost: number;
  fixed_cost: number;
  total_cost: number;
  net_revenue: number;
}

// 年次推定結果
export interface AnnualEstimate {
  gross_revenue: number;
  total_cost: number;
  net_revenue: number;
  avg_occupancy: number;
  avg_adr: number;
}

// 3レンジ（保守/標準/強気）
export interface EstimateRange {
  conservative: {
    monthly: MonthlyEstimate[];
    annual: AnnualEstimate;
  };
  standard: {
    monthly: MonthlyEstimate[];
    annual: AnnualEstimate;
  };
  optimistic: {
    monthly: MonthlyEstimate[];
    annual: AnnualEstimate;
  };
}

// 試算結果
export interface Estimate {
  id: string;
  property_id: string;
  created_at: string;
  geocode_result: {
    lat: number;
    lng: number;
    formatted_address: string;
  } | null;
  nearest_station: NearestStation | null;
  airdna_request: Record<string, unknown> | null;
  airdna_response: Record<string, unknown> | null;
  computed: EstimateRange | null;
  status: 'pending' | 'processing' | 'ok' | 'error';
  error_message: string | null;
}

// フォーム入力用
export interface PropertyFormInput {
  name: string;
  address: string;
  capacity: number;
  layoutText: string;
  bedrooms: number | null;
  bathrooms: number | null;
  description: string;
  cost: CostInput;
}

export interface CostInput {
  otaFeeRate: number;
  cleaningCostPerTurnover: number;
  linenCostPerTurnover: number;
  consumablesCostPerNight: number;
  utilitiesCostPerMonth: number;
  managementFeeRate: number;
  avgStayNights: number;
  otherFixedCostPerMonth: number;
}

// API リクエスト/レスポンス
export interface EstimateRequest {
  propertyId: string;
  address: string;
  capacity: number;
  layoutText: string;
  bedrooms: number | null;
  bathrooms: number | null;
  cost: CostInput;
}

export interface EstimateResponse {
  success: boolean;
  estimateId?: string;
  error?: string;
}

