import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

interface PropertyItem {
  id: string;
  url: string | null;
  title: string | null;
  price: number;
  priceMan: number;
  scraped_at: string | null;
  portal_site: { name: string; key: string } | null;
  property_id: string | null;
  address: string;
  city: string | null;
  building_area: number | null;
  land_area: number | null;
  built_year: number | null;
  rooms: number | null;
  property_type: string | null;
  annual_revenue: number;
  annual_revenue_man: number;
  annual_profit: number;
  annual_profit_man: number;
  actual_multiple: number;
  renovation_budget: number;
  renovation_budget_man: number;
  meets_condition: boolean;
  has_simulation: boolean;
  simulations: { id: string; scenario: string; annual_revenue: number | null; annual_profit: number | null }[];
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { searchParams } = new URL(request.url);
  
  const multiple = parseFloat(searchParams.get('multiple') || '7');
  const areas = searchParams.get('areas')?.split(',').filter(Boolean) || [];
  const propertyTypes = searchParams.get('types')?.split(',').filter(Boolean) || [];
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortKey = searchParams.get('sortKey') || 'scraped_at';
  const sortOrder = searchParams.get('sortOrder') || 'desc';
  const showAll = searchParams.get('showAll') === 'true';
  const includeNoSimulation = searchParams.get('includeNoSim') === 'true';

  try {
    // 全件取得してフィルタリング・ソート後にページング
    // （シミュレーション結果に基づくフィルタリングはDBクエリでは困難なため）
    let query = supabase
      .from('listings')
      .select(`
        id,
        url,
        title,
        price,
        scraped_at,
        property_id,
        portal_sites (
          name,
          key
        ),
        properties (
          id,
          address_raw,
          normalized_address,
          city,
          building_area,
          land_area,
          built_year,
          rooms,
          property_type
        ),
        simulations!simulations_listing_id_fkey (
          id,
          scenario,
          annual_revenue,
          annual_profit
        )
      `)
      .order('scraped_at', { ascending: false });

    // エリアフィルタ
    if (areas.length > 0) {
      query = query.in('properties.city', areas);
    }

    // 物件タイプフィルタ
    if (propertyTypes.length > 0) {
      query = query.in('properties.property_type', propertyTypes);
    }

    const { data: listings, error } = await query;

    if (error) {
      throw error;
    }

    // 整形とフィルタリング
    const allResults = listings
      ?.map(listing => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const property = listing.properties as any;

        const simulations = listing.simulations as {
          id: string;
          scenario: string;
          annual_revenue: number | null;
          annual_profit: number | null;
        }[];

        const neutralSim = simulations?.find(s => s.scenario === 'NEUTRAL');
        const annualRevenue = neutralSim?.annual_revenue || 0;
        const annualProfit = neutralSim?.annual_profit || Math.round(annualRevenue * 0.4);
        const price = listing.price || 0;
        
        const hasSimulation = annualRevenue > 0;
        
        // シミュレーション未実行の物件は除外（includeNoSim=trueなら表示）
        if (!hasSimulation && !includeNoSimulation) {
          return null;
        }
        
        // 倍率判定（利益ベース）
        const actualMultiple = annualProfit > 0 ? price / annualProfit : Infinity;
        const meetsCondition = hasSimulation ? actualMultiple <= multiple : false;

        // リノベ予算 = 年間利益×10 - 価格
        const renovationBudget = annualProfit * 10 - price;

        return {
          id: listing.id,
          url: listing.url,
          title: listing.title,
          price,
          priceMan: Math.round(price / 10000),
          scraped_at: listing.scraped_at,
          portal_site: listing.portal_sites,
          property_id: property?.id || null,
          address: property?.address_raw || property?.normalized_address || '',
          city: property?.city || null,
          building_area: property?.building_area || null,
          land_area: property?.land_area || null,
          built_year: property?.built_year || null,
          rooms: property?.rooms || null,
          property_type: property?.property_type || null,
          annual_revenue: annualRevenue,
          annual_revenue_man: Math.round(annualRevenue / 10000),
          annual_profit: annualProfit,
          annual_profit_man: Math.round(annualProfit / 10000),
          actual_multiple: actualMultiple,
          renovation_budget: renovationBudget,
          renovation_budget_man: Math.round(renovationBudget / 10000),
          meets_condition: meetsCondition,
          has_simulation: hasSimulation,
          simulations,
        };
      })
      .filter((item): item is PropertyItem => item !== null && (showAll || includeNoSimulation || item.meets_condition));

    // ソート
    const sortedResults = [...allResults].sort((a, b) => {
      let aVal: number | string | null = null;
      let bVal: number | string | null = null;

      switch (sortKey) {
        case 'price':
          aVal = a.price;
          bVal = b.price;
          break;
        case 'annual_profit':
          aVal = a.annual_profit;
          bVal = b.annual_profit;
          break;
        case 'actual_multiple':
          // Infinityは最後に
          aVal = isFinite(a.actual_multiple) ? a.actual_multiple : 9999999;
          bVal = isFinite(b.actual_multiple) ? b.actual_multiple : 9999999;
          break;
        case 'scraped_at':
        default:
          aVal = a.scraped_at || '';
          bVal = b.scraped_at || '';
          break;
      }

      if (aVal === null || aVal === undefined) aVal = sortOrder === 'asc' ? Infinity : -Infinity;
      if (bVal === null || bVal === undefined) bVal = sortOrder === 'asc' ? Infinity : -Infinity;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return sortOrder === 'asc' 
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

    // ページング
    const totalCount = sortedResults.length;
    const offset = (page - 1) * limit;
    const pagedResults = sortedResults.slice(offset, offset + limit);

    return NextResponse.json({
      items: pagedResults,
      total: pagedResults.length,
      totalCount, // フィルタリング後の総件数
      page,
      limit,
      multiple,
    });
  } catch (error) {
    console.error('Failed to fetch properties:', error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
