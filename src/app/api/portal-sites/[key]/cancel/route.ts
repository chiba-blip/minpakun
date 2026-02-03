import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const supabase = await createSupabaseServer();

  try {
    // 進捗テーブルのステータスを'cancelled'に更新
    const { data, error } = await supabase
      .from('scrape_progress')
      .update({ 
        status: 'cancelled',
      })
      .eq('site_key', key)
      .eq('status', 'in_progress')
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ 
        success: false, 
        error: error.message || 'データベースエラー'
      }, { status: 500 });
    }

    // 更新された行がない場合も成功とする（すでに完了している可能性）
    return NextResponse.json({ 
      success: true, 
      message: `${key}のスクレイピングを中止しました`,
      updated: data?.length || 0
    });
  } catch (error) {
    console.error('Failed to cancel scraping:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
