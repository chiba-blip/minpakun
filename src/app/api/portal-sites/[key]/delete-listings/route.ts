import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * 特定ポータルサイトの物件を全削除
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

    // このサイトのlistingsを取得
    const { data: listings } = await supabase
      .from('listings')
      .select('id')
      .eq('portal_site_id', site.id);

    const listingIds = listings?.map(l => l.id) || [];

    if (listingIds.length === 0) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    // simulation_monthliesを削除（simulationsのcascadeで削除される）
    // simulationsを削除
    await supabase
      .from('simulations')
      .delete()
      .in('listing_id', listingIds);

    // listingsを削除
    const { error: deleteError } = await supabase
      .from('listings')
      .delete()
      .eq('portal_site_id', site.id);

    if (deleteError) throw deleteError;

    // 孤立したproperties（他のlistingsがない）を削除
    // これは複雑なので、とりあえずスキップ

    return NextResponse.json({ success: true, deleted: listingIds.length });
  } catch (error) {
    console.error('Failed to delete listings:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
