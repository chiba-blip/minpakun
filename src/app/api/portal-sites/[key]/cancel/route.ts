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
    const { error } = await supabase
      .from('scrape_progress')
      .update({ 
        status: 'cancelled',
      })
      .eq('site_key', key)
      .eq('status', 'in_progress');

    if (error) {
      throw error;
    }

    return NextResponse.json({ 
      success: true, 
      message: `${key}のスクレイピングを中止しました` 
    });
  } catch (error) {
    console.error('Failed to cancel scraping:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
