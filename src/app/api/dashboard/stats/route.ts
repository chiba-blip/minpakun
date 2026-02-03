import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = await createSupabaseServer();

  try {
    // 総リスティング数（全ポータルの合計）
    const { count: totalListings } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true });

    // 総物件数 = 総リスティング数として表示（ユーザーにとってわかりやすい）
    const totalProperties = totalListings;

    // シミュレーション済み件数（listing_idでユニーク）
    const { data: simData } = await supabase
      .from('simulations')
      .select('listing_id');
    const simulatedCount = new Set(simData?.map(s => s.listing_id).filter(Boolean)).size;

    // 条件適合物件（価格 < 年間収益 × 7）
    const { data: matchData } = await supabase
      .from('listings')
      .select(`
        id,
        price,
        property_id,
        simulations!inner (
          annual_revenue,
          scenario
        )
      `)
      .eq('simulations.scenario', 'NEUTRAL')
      .not('price', 'is', null);

    const matchingCount = matchData?.filter(l => {
      const sim = (l.simulations as { annual_revenue: number }[])?.[0];
      return sim && l.price && l.price < sim.annual_revenue * 7;
    }).length ?? 0;

    // 最終スクレイプ日時
    const { data: lastScrape } = await supabase
      .from('listings')
      .select('scraped_at')
      .order('scraped_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      totalProperties: totalProperties ?? 0,
      totalListings: totalListings ?? 0,
      simulatedCount,
      matchingCount,
      lastScrapeAt: lastScrape?.scraped_at ?? null,
    });
  } catch (error) {
    console.error('Failed to fetch dashboard stats:', error);
    return NextResponse.json({
      totalProperties: 0,
      totalListings: 0,
      simulatedCount: 0,
      matchingCount: 0,
      lastScrapeAt: null,
    });
  }
}
