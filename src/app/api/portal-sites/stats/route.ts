import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * ポータルサイトごとの統計情報を取得
 */
export async function GET() {
  const supabase = await createSupabaseServer();

  try {
    // ポータルサイト一覧を取得
    const { data: sites, error: sitesError } = await supabase
      .from('portal_sites')
      .select('*')
      .order('name', { ascending: true });

    if (sitesError) throw sitesError;

    // 各サイトの統計を計算
    const siteStats = await Promise.all(
      (sites || []).map(async (site) => {
        // 物件数（listings）
        const { count: listingsCount } = await supabase
          .from('listings')
          .select('*', { count: 'exact', head: true })
          .eq('portal_site_id', site.id);

        // 最終取得日時
        const { data: lastListing } = await supabase
          .from('listings')
          .select('scraped_at')
          .eq('portal_site_id', site.id)
          .order('scraped_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // シミュレーション済み件数
        const { data: simData } = await supabase
          .from('listings')
          .select('id, simulations!inner(id)')
          .eq('portal_site_id', site.id);
        const simulatedCount = simData?.length || 0;

        return {
          id: site.id,
          key: site.key,
          name: site.name,
          enabled: site.enabled,
          listingsCount: listingsCount || 0,
          simulatedCount,
          lastScrapedAt: lastListing?.scraped_at || null,
        };
      })
    );

    return NextResponse.json({ sites: siteStats });
  } catch (error) {
    console.error('Failed to fetch portal sites stats:', error);
    return NextResponse.json(
      { error: String(error), sites: [] },
      { status: 500 }
    );
  }
}
