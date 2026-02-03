import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * ポータルサイトの設定更新（ON/OFF、物件タイプ）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const supabase = await createSupabaseServer();
  const { key } = await params;

  try {
    const body = await request.json();
    
    // 更新するフィールドを構築
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any = {};
    
    if (body.enabled !== undefined) {
      updates.enabled = body.enabled === true;
    }
    
    if (body.property_types !== undefined) {
      updates.property_types = body.property_types;
    }

    const { error } = await supabase
      .from('portal_sites')
      .update(updates)
      .eq('key', key);

    if (error) throw error;

    return NextResponse.json({ success: true, ...updates });
  } catch (error) {
    console.error('Failed to update portal site:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
