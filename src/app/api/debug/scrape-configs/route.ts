import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = await createSupabaseServer();
  
  // すべてのscrape_configsレコードを取得
  const { data, error } = await supabase
    .from('scrape_configs')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    count: data?.length || 0,
    records: data,
    message: data && data.length > 1 
      ? '複数のレコードがあります。最初のレコードのみが使用されます。' 
      : 'OK',
  });
}

// 不要なレコードを削除（最初のレコード以外）
export async function DELETE() {
  const supabase = await createSupabaseServer();
  
  // すべてのレコードを取得
  const { data: all } = await supabase
    .from('scrape_configs')
    .select('id')
    .order('created_at', { ascending: true });
  
  if (!all || all.length <= 1) {
    return NextResponse.json({ message: '削除対象なし', deleted: 0 });
  }
  
  // 最初のレコード以外を削除
  const idsToDelete = all.slice(1).map(r => r.id);
  
  const { error } = await supabase
    .from('scrape_configs')
    .delete()
    .in('id', idsToDelete);
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  
  return NextResponse.json({ message: '削除完了', deleted: idsToDelete.length });
}
