import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = await createSupabaseServer();
  
  // リスティング数を確認
  const { count: listingsCount } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true });

  // ポータルサイト別のリスティング数
  const { data: portalStats } = await supabase
    .from('listings')
    .select('portal_site_id, portal_sites(name, key)')
    .limit(1000);

  const portalCounts: Record<string, number> = {};
  portalStats?.forEach((l: any) => {
    const key = l.portal_sites?.key || 'unknown';
    portalCounts[key] = (portalCounts[key] || 0) + 1;
  });

  // property_idがnullのリスティング数
  const { count: noPropertyCount } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true })
    .is('property_id', null);

  // シミュレーション数
  const { count: simulationsCount } = await supabase
    .from('simulations')
    .select('*', { count: 'exact', head: true });

  // シミュレーションがあるリスティング（ユニーク）
  const { data: simListings } = await supabase
    .from('simulations')
    .select('listing_id')
    .limit(1000);
  
  const uniqueSimListings = new Set(simListings?.map(s => s.listing_id)).size;

  // サンプルリスティング（最新5件）
  const { data: sampleListings } = await supabase
    .from('listings')
    .select(`
      id,
      url,
      title,
      price,
      property_id,
      portal_sites(name, key),
      properties(id, city, building_area),
      simulations(id, scenario, annual_revenue)
    `)
    .order('scraped_at', { ascending: false })
    .limit(5);

  return NextResponse.json({
    summary: {
      total_listings: listingsCount,
      listings_without_property: noPropertyCount,
      listings_with_property: (listingsCount || 0) - (noPropertyCount || 0),
      total_simulations: simulationsCount,
      listings_with_simulation: uniqueSimListings,
    },
    portal_counts: portalCounts,
    sample_listings: sampleListings,
  });
}
