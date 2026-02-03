import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = await createSupabaseServer();
  
  // 最初のレコードを取得（1つしかない想定）
  const { data, error } = await supabase
    .from('scrape_configs')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error) {
    console.error('[scrape settings] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const body = await request.json();
  const { id, enabled, areas, property_types } = body;

  // idがない場合は最初のレコードを取得して更新
  let targetId = id;
  if (!targetId) {
    const { data: existing } = await supabase
      .from('scrape_configs')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    targetId = existing?.id;
  }

  if (!targetId) {
    return NextResponse.json({ error: 'レコードが見つかりません' }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};
  if (enabled !== undefined) updateData.enabled = enabled;
  if (areas !== undefined) updateData.areas = areas;
  if (property_types !== undefined) updateData.property_types = property_types;

  const { data, error } = await supabase
    .from('scrape_configs')
    .update(updateData)
    .eq('id', targetId)
    .select()
    .single();

  if (error) {
    console.error('[scrape settings] Update error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
