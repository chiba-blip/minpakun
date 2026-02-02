/**
 * AirROI API クライアント
 * 
 * 民泊類似物件の売上推計を取得
 * https://airroi.com/api-docs
 */

const AIRROI_BASE_URL = 'https://api.airroi.com/v1';

interface AirROIConfig {
  apiKey: string;
}

interface Comparable {
  listing_id: string;
  title: string;
  bedrooms: number;
  guests: number;
  distance_km: number;
  nightly_rate: number;
}

interface ComparablesResponse {
  comparables: Comparable[];
  total: number;
}

interface MonthlyMetric {
  month: string; // "2025-01"
  revenue: number;
  occupancy: number; // 0-100
  adr: number;
  booked_nights: number;
}

interface MetricsResponse {
  listing_id: string;
  metrics: MonthlyMetric[];
}

export class AirROIClient {
  private apiKey: string;

  constructor(config?: AirROIConfig) {
    this.apiKey = config?.apiKey || process.env.AIRROI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('AIRROI_API_KEY is not configured');
    }
  }

  /**
   * 類似物件（Comparables）を取得
   */
  async getComparables(params: {
    lat: number;
    lng: number;
    bedrooms: number;
    guests: number;
    radius_km?: number;
    limit?: number;
  }): Promise<ComparablesResponse> {
    const url = new URL(`${AIRROI_BASE_URL}/listings/comparables`);
    url.searchParams.set('lat', params.lat.toString());
    url.searchParams.set('lng', params.lng.toString());
    url.searchParams.set('bedrooms', params.bedrooms.toString());
    url.searchParams.set('guests', params.guests.toString());
    if (params.radius_km) url.searchParams.set('radius_km', params.radius_km.toString());
    if (params.limit) url.searchParams.set('limit', params.limit.toString());

    const res = await fetch(url.toString(), {
      headers: {
        'X-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`AirROI comparables error: ${res.status} - ${error}`);
    }

    return res.json();
  }

  /**
   * 複数物件の月次メトリクスを一括取得
   */
  async getMetricsBulk(listingIds: string[], numMonths: number = 12): Promise<MetricsResponse[]> {
    const url = new URL(`${AIRROI_BASE_URL}/listings/metrics/all`);
    url.searchParams.set('listing_ids', listingIds.join(','));
    url.searchParams.set('num_months', numMonths.toString());

    const res = await fetch(url.toString(), {
      headers: {
        'X-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`AirROI metrics error: ${res.status} - ${error}`);
    }

    return res.json();
  }
}

/**
 * 建物面積からbedrooms/guestsを推定
 * @param buildingArea 建物面積（㎡）
 * @param isApartment 集合住宅かどうか
 * @param units 戸数（集合住宅の場合）
 */
export function estimateBedroomsAndGuests(
  buildingArea: number,
  isApartment: boolean = false,
  units: number = 1
): { bedrooms: number; guests: number; areaPerUnit: number } {
  // 集合住宅の場合は1部屋あたりの面積を計算
  const areaPerUnit = isApartment && units > 1 
    ? buildingArea / units 
    : buildingArea;
  
  // bedroom数 = 建物面積 ÷ 40（切り上げ）
  const bedrooms = Math.ceil(areaPerUnit / 40);
  
  // guests数 = bedroom数 × 2 + 1
  const guests = bedrooms * 2 + 1;
  
  return { bedrooms, guests, areaPerUnit };
}

/**
 * AirROIデータから月次売上を集計
 */
export interface AggregatedMonthly {
  month: number; // 1-12
  avgRevenue: number;
  medianRevenue: number;
  avgOccupancy: number;
  avgAdr: number;
  avgBookedNights: number;
  sampleSize: number;
}

export function aggregateMonthlyMetrics(
  metricsResponses: MetricsResponse[]
): AggregatedMonthly[] {
  // 月ごとにデータを集約
  const monthlyData: Record<number, {
    revenues: number[];
    occupancies: number[];
    adrs: number[];
    bookedNights: number[];
  }> = {};

  // 1-12月を初期化
  for (let m = 1; m <= 12; m++) {
    monthlyData[m] = { revenues: [], occupancies: [], adrs: [], bookedNights: [] };
  }

  for (const response of metricsResponses) {
    for (const metric of response.metrics) {
      // "2025-01" から月を抽出
      const monthNum = parseInt(metric.month.split('-')[1], 10);
      if (monthNum >= 1 && monthNum <= 12) {
        monthlyData[monthNum].revenues.push(metric.revenue);
        monthlyData[monthNum].occupancies.push(metric.occupancy);
        monthlyData[monthNum].adrs.push(metric.adr);
        monthlyData[monthNum].bookedNights.push(metric.booked_nights);
      }
    }
  }

  const result: AggregatedMonthly[] = [];

  for (let month = 1; month <= 12; month++) {
    const data = monthlyData[month];
    const n = data.revenues.length;

    if (n === 0) {
      // データがない場合はデフォルト値
      result.push({
        month,
        avgRevenue: 0,
        medianRevenue: 0,
        avgOccupancy: 0,
        avgAdr: 0,
        avgBookedNights: 0,
        sampleSize: 0,
      });
      continue;
    }

    // 平均
    const avgRevenue = data.revenues.reduce((a, b) => a + b, 0) / n;
    const avgOccupancy = data.occupancies.reduce((a, b) => a + b, 0) / n;
    const avgAdr = data.adrs.reduce((a, b) => a + b, 0) / n;
    const avgBookedNights = data.bookedNights.reduce((a, b) => a + b, 0) / n;

    // 中央値
    const sortedRevenues = [...data.revenues].sort((a, b) => a - b);
    const mid = Math.floor(n / 2);
    const medianRevenue = n % 2 === 0
      ? (sortedRevenues[mid - 1] + sortedRevenues[mid]) / 2
      : sortedRevenues[mid];

    result.push({
      month,
      avgRevenue: Math.round(avgRevenue),
      medianRevenue: Math.round(medianRevenue),
      avgOccupancy: Math.round(avgOccupancy * 10) / 10,
      avgAdr: Math.round(avgAdr),
      avgBookedNights: Math.round(avgBookedNights * 10) / 10,
      sampleSize: n,
    });
  }

  return result;
}

/**
 * 月次データから稼働泊数と予約数を計算
 */
export function calculateBookingMetrics(
  occupancyRate: number, // 0-100
  daysInMonth: number,
  avgStayPerBooking: number = 2.5
): { bookedNights: number; reservations: number } {
  // 稼働泊数 = occupancy × 日数 / 100
  const bookedNights = Math.round((occupancyRate / 100) * daysInMonth);
  
  // 予約数 = 稼働泊数 ÷ 平均宿泊日数（四捨五入）
  const reservations = Math.round(bookedNights / avgStayPerBooking);
  
  return { bookedNights, reservations };
}

/**
 * 月の日数
 */
export const DAYS_IN_MONTH: Record<number, number> = {
  1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30,
  7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};
