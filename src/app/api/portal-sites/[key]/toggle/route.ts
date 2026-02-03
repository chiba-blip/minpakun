import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * ポータルサイトのON/OFF切り替え
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const supabase = await createSupabaseServer();
  const { key } = await params;

  try {
    const body = await request.json();
    const enabled = body.enabled === true;

    const { error } = await supabase
      .from('portal_sites')
      .update({ enabled })
      .eq('key', key);

    if (error) throw error;

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    console.error('Failed to toggle portal site:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
