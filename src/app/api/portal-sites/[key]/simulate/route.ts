import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * 特定ポータルサイトのシミュレーションを実行
 * （既存のsimulate APIを呼び出すラッパー）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const supabase = await createSupabaseServer();
  const { key } = await params;

  try {
    // ポータルサイトを取得
    const { data: site, error: siteError } = await supabase
      .from('portal_sites')
      .select('id')
      .eq('key', key)
      .single();

    if (siteError || !site) {
      return NextResponse.json(
        { success: false, error: 'ポータルサイトが見つかりません' },
        { status: 404 }
      );
    }

    // このサイトのシミュレーション未実行のlistingsを取得
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select(`
        id,
        property_id,
        price,
        properties (
          id,
          building_area,
          land_area,
          rooms,
          property_type,
          city,
          address_raw
        )
      `)
      .eq('portal_site_id', site.id)
      .not('property_id', 'is', null);

    if (listingsError) throw listingsError;

    if (!listings || listings.length === 0) {
      return NextResponse.json({
        success: true,
        simulated: 0,
        message: 'シミュレーション対象の物件がありません',
      });
    }

    // 既存シミュレーションがないものをフィルタ
    let simulatedCount = 0;
    for (const listing of listings) {
      const { data: existingSim } = await supabase
        .from('simulations')
        .select('id')
        .eq('listing_id', listing.id)
        .limit(1);

      if (!existingSim || existingSim.length === 0) {
        // シミュレーション未実行
        // TODO: 実際のシミュレーションロジックを呼び出す
        // 今回は既存のsimulate APIにリダイレクトするのではなく、
        // 単純にカウントだけ返す（実際の実装は既存APIを使用）
        simulatedCount++;
      }
    }

    // 実際のシミュレーションは既存の /api/jobs/simulate を使用するため、
    // ここでは対象件数のみ返す
    return NextResponse.json({
      success: true,
      targetCount: simulatedCount,
      message: `${simulatedCount}件のシミュレーション対象があります。全体シミュレーション実行を使用してください。`,
    });
  } catch (error) {
    console.error('Failed to run simulation:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
