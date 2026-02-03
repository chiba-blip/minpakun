import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * 特定ポータルサイトのシミュレーションを全削除
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
    const { data: deleted, error: deleteError } = await supabase
      .from('simulations')
      .delete()
      .in('listing_id', listingIds)
      .select('id');

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true, deleted: deleted?.length || 0 });
  } catch (error) {
    console.error('Failed to delete simulations:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
