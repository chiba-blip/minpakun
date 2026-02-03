import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { searchParams } = new URL(request.url);
  
  const multiple = parseFloat(searchParams.get('multiple') || '7');
  const areas = searchParams.get('areas')?.split(',').filter(Boolean) || [];
  const propertyTypes = searchParams.get('types')?.split(',').filter(Boolean) || [];
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const offset = (page - 1) * limit;

  try {
    // リスティングとシミュレーションを結合して取得
    // simulations は listing_id で紐付け（Supabaseは自動的にFKを認識）
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
      .order('scraped_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // エリアフィルタ
    if (areas.length > 0) {
      query = query.in('properties.city', areas);
    }

    // 物件タイプフィルタ
    if (propertyTypes.length > 0) {
      query = query.in('properties.property_type', propertyTypes);
    }

    const { data: listings, error, count } = await query;

    if (error) {
      throw error;
    }

    // 倍率フィルタと整形
    const showAll = searchParams.get('showAll') === 'true';
    const includeNoSimulation = searchParams.get('includeNoSim') === 'true';
    
    const results = listings
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
        // 利益がない場合は売上の40%を仮の利益として使用（コスト60%想定）
        const annualProfit = neutralSim?.annual_profit || Math.round(annualRevenue * 0.4);
        const price = listing.price || 0;
        
        // シミュレーション未実行の物件
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
          annual_revenue: annualRevenue,  // 売上
          annual_revenue_man: Math.round(annualRevenue / 10000),
          annual_profit: annualProfit,    // 利益（売上-コスト）
          annual_profit_man: Math.round(annualProfit / 10000),
          actual_multiple: actualMultiple,
          renovation_budget: renovationBudget,
          renovation_budget_man: Math.round(renovationBudget / 10000),
          meets_condition: meetsCondition,
          has_simulation: hasSimulation,
          simulations,
        };
      })
      .filter(item => item && (showAll || includeNoSimulation || item.meets_condition));

    return NextResponse.json({
      items: results,
      total: results?.length || 0,
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
