/**
 * AirROI API クライアント
 * 
 * 民泊類似物件の売上推計を取得
 * https://www.airroi.com/api/documentation
 */

const AIRROI_BASE_URL = 'https://api.airroi.com';

interface AirROIConfig {
  apiKey: string;
}

// 類似物件レスポンスの型
interface ComparableListing {
  listing_info: {
    listing_id: number;
    listing_name: string;
  };
  property_details: {
    bedrooms: number;
    guests: number;
    baths: number;
  };
  performance_metrics: {
    ttm_revenue: number;
    ttm_avg_rate: number;
    ttm_occupancy: number;
  };
}

interface ComparablesResponse {
  listings: ComparableListing[];
}

// 月次メトリクスレスポンスの型
interface MonthlyMetric {
  date: string; // "2024-01"
  revenue: number;
  occupancy: number; // 0-1
  average_daily_rate: number;
}

interface MetricsResponse {
  results: MonthlyMetric[];
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
   * ドキュメント: GET /listings/comparables
   */
  async getComparables(params: {
    lat: number;
    lng: number;
    bedrooms: number;
    baths: number;
    guests: number;
  }): Promise<ComparablesResponse> {
    const url = new URL(`${AIRROI_BASE_URL}/listings/comparables`);
    url.searchParams.set('latitude', params.lat.toString());
    url.searchParams.set('longitude', params.lng.toString());
    url.searchParams.set('bedrooms', params.bedrooms.toString());
    url.searchParams.set('baths', params.baths.toString());
    url.searchParams.set('guests', params.guests.toString());
    url.searchParams.set('currency', 'native');

    console.log(`[AirROI] Fetching comparables: ${url.toString()}`);

    const res = await fetch(url.toString(), {
      headers: {
        'X-API-KEY': this.apiKey,
      },
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`AirROI comparables error: ${res.status} - ${error}`);
    }

    return res.json();
  }

  /**
   * 物件の月次メトリクスを取得
   * ドキュメント: GET /listings/metrics/all
   */
  async getListingMetrics(listingId: number, numMonths: number = 12): Promise<MetricsResponse> {
    const url = new URL(`${AIRROI_BASE_URL}/listings/metrics/all`);
    url.searchParams.set('id', listingId.toString());
    url.searchParams.set('num_months', numMonths.toString());
    url.searchParams.set('currency', 'native');

    const res = await fetch(url.toString(), {
      headers: {
        'X-API-KEY': this.apiKey,
      },
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`AirROI metrics error: ${res.status} - ${error}`);
    }

    return res.json();
  }

  /**
   * 複数物件の月次メトリクスを取得（順次処理）
   */
  async getMetricsBulk(listingIds: number[], numMonths: number = 12): Promise<MetricsResponse[]> {
    const results: MetricsResponse[] = [];
    
    // 最大10件まで取得（API負荷を考慮）
    const idsToFetch = listingIds.slice(0, 10);
    
    for (const id of idsToFetch) {
      try {
        const metrics = await this.getListingMetrics(id, numMonths);
        results.push(metrics);
        // APIレート制限を考慮
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.warn(`[AirROI] Failed to get metrics for listing ${id}:`, error);
      }
    }
    
    return results;
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
  }> = {};

  // 1-12月を初期化
  for (let m = 1; m <= 12; m++) {
    monthlyData[m] = { revenues: [], occupancies: [], adrs: [] };
  }

  for (const response of metricsResponses) {
    for (const metric of response.results) {
      // "2024-01" から月を抽出
      const monthNum = parseInt(metric.date.split('-')[1], 10);
      if (monthNum >= 1 && monthNum <= 12) {
        monthlyData[monthNum].revenues.push(metric.revenue);
        // occupancyは0-1形式なので100倍して%に変換
        monthlyData[monthNum].occupancies.push(metric.occupancy * 100);
        monthlyData[monthNum].adrs.push(metric.average_daily_rate);
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
    
    // 稼働泊数を計算
    const daysInMonth = DAYS_IN_MONTH[month];
    const avgBookedNights = (avgOccupancy / 100) * daysInMonth;

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
