/**
 * AirDNA Rentalizer API クライアント
 * 
 * 注意: AirDNA APIはEnterprise/API契約が必要です。
 * 契約後に提供されるAPI仕様に合わせて実装を調整してください。
 */

export interface RentalizerRequest {
  lat: number;
  lng: number;
  bedrooms: number;
  bathrooms?: number;
  accommodates?: number;
}

export interface RentalizerMonthly {
  month: number;
  revenue: number;
  adr: number;
  occupancy: number;
}

export interface RentalizerResponse {
  annual_revenue: number;
  annual_adr: number;
  annual_occupancy: number;
  monthly: RentalizerMonthly[];
}

/**
 * AirDNA Rentalizer APIを呼び出して売上推定を取得
 */
export async function callRentalizer(
  request: RentalizerRequest
): Promise<RentalizerResponse> {
  const apiKey = process.env.AIRDNA_API_KEY;
  
  if (!apiKey) {
    throw new Error('AIRDNA_API_KEY is not configured');
  }

  // 注意: 実際のAPIエンドポイントとパラメータは契約後のドキュメントを参照してください
  // 以下は推定される構造です
  const url = new URL('https://api.airdna.co/v1/rentalizer');
  url.searchParams.set('lat', request.lat.toString());
  url.searchParams.set('lng', request.lng.toString());
  url.searchParams.set('bedrooms', request.bedrooms.toString());
  if (request.bathrooms) {
    url.searchParams.set('bathrooms', request.bathrooms.toString());
  }
  if (request.accommodates) {
    url.searchParams.set('accommodates', request.accommodates.toString());
  }

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AirDNA API error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  
  // レスポンス構造は契約後に確認して調整が必要
  // 以下は一般的な構造を想定したマッピング
  return {
    annual_revenue: data.revenue?.ltm || data.annual_revenue || 0,
    annual_adr: data.adr?.ltm || data.annual_adr || 0,
    annual_occupancy: data.occupancy?.ltm || data.annual_occupancy || 0,
    monthly: parseMonthlyData(data),
  };
}

function parseMonthlyData(data: Record<string, unknown>): RentalizerMonthly[] {
  // AirDNAのレスポンス構造に応じて調整が必要
  const months: RentalizerMonthly[] = [];
  
  // 月次データがある場合
  if (data.monthly && Array.isArray(data.monthly)) {
    return data.monthly.map((m: { month: number; revenue: number; adr: number; occupancy: number }) => ({
      month: m.month,
      revenue: m.revenue || 0,
      adr: m.adr || 0,
      occupancy: m.occupancy || 0,
    }));
  }
  
  // 月次データがない場合は年次データから均等分配（仮）
  const annualRevenue = (data.revenue as { ltm?: number })?.ltm || 0;
  const annualAdr = (data.adr as { ltm?: number })?.ltm || 0;
  const annualOccupancy = (data.occupancy as { ltm?: number })?.ltm || 0;
  
  for (let month = 1; month <= 12; month++) {
    months.push({
      month,
      revenue: annualRevenue / 12,
      adr: annualAdr,
      occupancy: annualOccupancy,
    });
  }
  
  return months;
}

/**
 * テスト用のダミーレスポンス（API契約前の開発用）
 */
export function getMockRentalizerResponse(
  bedrooms: number
): RentalizerResponse {
  // 北海道の民泊相場を想定したダミーデータ
  const baseRevenue = 200000 + bedrooms * 100000; // 寝室数に応じた基本売上
  const baseAdr = 15000 + bedrooms * 5000; // 寝室数に応じたADR
  const baseOccupancy = 0.55; // 基本稼働率55%
  
  // 季節変動係数（北海道：冬と夏がハイシーズン）
  const seasonalFactors = [
    0.9,  // 1月（冬）
    1.2,  // 2月（雪まつり）
    0.8,  // 3月
    0.6,  // 4月
    0.7,  // 5月
    0.8,  // 6月
    1.3,  // 7月（夏）
    1.4,  // 8月（夏ピーク）
    0.9,  // 9月
    0.7,  // 10月
    0.6,  // 11月
    1.1,  // 12月（年末）
  ];
  
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  
  const monthly: RentalizerMonthly[] = seasonalFactors.map((factor, index) => {
    const occupancy = Math.min(baseOccupancy * factor, 0.95);
    const adr = baseAdr * (1 + (factor - 1) * 0.3); // 季節変動は小さめ
    const revenue = adr * daysInMonth[index] * occupancy;
    
    return {
      month: index + 1,
      revenue: Math.round(revenue),
      adr: Math.round(adr),
      occupancy: Math.round(occupancy * 100) / 100,
    };
  });
  
  const annual_revenue = monthly.reduce((sum, m) => sum + m.revenue, 0);
  const annual_adr = Math.round(monthly.reduce((sum, m) => sum + m.adr, 0) / 12);
  const annual_occupancy = Math.round(
    (monthly.reduce((sum, m) => sum + m.occupancy, 0) / 12) * 100
  ) / 100;
  
  return {
    annual_revenue,
    annual_adr,
    annual_occupancy,
    monthly,
  };
}

