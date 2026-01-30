import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { searchParams } = new URL(request.url);
  
  const multiple = parseFloat(searchParams.get('multiple') || '7');
  const areas = searchParams.get('areas')?.split(',').filter(Boolean) || [];
  const propertyTypes = searchParams.get('types')?.split(',').filter(Boolean) || [];

  try {
    // リスティングとシミュレーションを結合して取得
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
        properties!inner (
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
        simulations (
          id,
          scenario,
          annual_revenue,
          annual_profit
        )
      `)
      .not('price', 'is', null)
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

    // 倍率フィルタと整形
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
        const negativeSim = simulations?.find(s => s.scenario === 'NEGATIVE');
        const positiveSim = simulations?.find(s => s.scenario === 'POSITIVE');
        
        const annualRevenue = neutralSim?.annual_revenue || 0;
        const price = listing.price || 0;
        
        // 倍率判定
        const actualMultiple = annualRevenue > 0 ? price / annualRevenue : Infinity;
        const meetsCondition = actualMultiple <= multiple;

        if (!meetsCondition) return null;

        // リノベ予算 = 年間収益×10 - 価格
        const renovationBudget = annualRevenue * 10 - price;

        return {
          url: listing.url,
          title: listing.title || '',
          portalSite: (listing.portal_sites as any)?.name || '',
          price,
          priceMan: Math.round(price / 10000),
          address: property.address_raw || property.normalized_address || '',
          city: property.city || '',
          buildingArea: property.building_area,
          landArea: property.land_area,
          builtYear: property.built_year,
          rooms: property.rooms,
          propertyType: property.property_type || '',
          annualRevenueNeutral: annualRevenue,
          annualRevenueNegative: negativeSim?.annual_revenue || 0,
          annualRevenuePositive: positiveSim?.annual_revenue || 0,
          actualMultiple,
          renovationBudget,
          scrapedAt: listing.scraped_at,
        };
      })
      .filter(Boolean);

    // CSV生成
    const headers = [
      '物件名',
      'ポータルサイト',
      '販売価格(万円)',
      '年間収益_中立(万円)',
      '年間収益_ネガティブ(万円)',
      '年間収益_ポジティブ(万円)',
      '倍率',
      'リノベ予算(万円)',
      '所在地',
      '市区町村',
      '建物面積(㎡)',
      '土地面積(㎡)',
      '築年',
      '部屋数',
      '物件タイプ',
      'URL',
      '取得日時',
    ];

    const rows = results?.map(item => [
      `"${(item?.title || '').replace(/"/g, '""')}"`,
      item?.portalSite || '',
      item?.priceMan || '',
      Math.round((item?.annualRevenueNeutral || 0) / 10000),
      Math.round((item?.annualRevenueNegative || 0) / 10000),
      Math.round((item?.annualRevenuePositive || 0) / 10000),
      item?.actualMultiple?.toFixed(2) || '',
      Math.round((item?.renovationBudget || 0) / 10000),
      `"${(item?.address || '').replace(/"/g, '""')}"`,
      item?.city || '',
      item?.buildingArea || '',
      item?.landArea || '',
      item?.builtYear || '',
      item?.rooms || '',
      item?.propertyType || '',
      item?.url || '',
      item?.scrapedAt || '',
    ]) || [];

    // BOM付きUTF-8 CSV
    const bom = '\uFEFF';
    const csvContent = bom + [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');

    const now = new Date().toISOString().slice(0, 10);
    const filename = `minpakun_properties_${now}.csv`;

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Failed to generate CSV:', error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
