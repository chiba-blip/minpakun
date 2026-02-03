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
  let existingConfig = null;
  
  if (!targetId) {
    const { data: existing } = await supabase
      .from('scrape_configs')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    targetId = existing?.id;
    existingConfig = existing;
  } else {
    const { data: existing } = await supabase
      .from('scrape_configs')
      .select('*')
      .eq('id', targetId)
      .single();
    existingConfig = existing;
  }

  if (!targetId) {
    return NextResponse.json({ error: 'レコードが見つかりません' }, { status: 404 });
  }

  // 条件が変更されたかチェック
  const areasChanged = areas !== undefined && 
    JSON.stringify(areas.sort()) !== JSON.stringify((existingConfig?.areas || []).sort());
  const typesChanged = property_types !== undefined && 
    JSON.stringify(property_types.sort()) !== JSON.stringify((existingConfig?.property_types || []).sort());
  const configChanged = areasChanged || typesChanged;

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

  // 条件が変更された場合、実行中のスクレイプをキャンセルして進捗をリセット
  if (configChanged) {
    console.log('[scrape settings] Config changed, cancelling and resetting progress');
    
    // 実行中のスクレイプをキャンセル
    await supabase
      .from('scrape_progress')
      .update({ status: 'cancelled' })
      .eq('status', 'in_progress');
    
    // 全ての進捗をリセット（削除）
    await supabase
      .from('scrape_progress')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // 全削除
  }

  return NextResponse.json({ 
    ...data, 
    config_changed: configChanged,
    progress_reset: configChanged,
  });
}
