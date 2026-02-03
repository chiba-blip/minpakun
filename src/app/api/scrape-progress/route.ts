import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * スクレイプ進捗を取得
 */
export async function GET() {
  const supabase = await createSupabaseServer();

  try {
    const { data: progress, error } = await supabase
      .from('scrape_progress')
      .select('*')
      .order('area_name', { ascending: true });

    // テーブルが存在しない場合は空配列を返す
    if (error) {
      if (error.message.includes('does not exist') || error.code === '42P01') {
        console.log('scrape_progress table does not exist yet');
        return NextResponse.json({
          progress: [],
          summary: { total: 0, completed: 0, inProgress: 0, pending: 0, totalInserted: 0, allCompleted: false },
        });
      }
      throw error;
    }

    // 統計情報も計算
    const total = progress?.length || 0;
    const completed = progress?.filter(p => p.status === 'completed').length || 0;
    const inProgress = progress?.filter(p => p.status === 'in_progress').length || 0;
    const totalInserted = progress?.reduce((sum, p) => sum + (p.inserted_count || 0), 0) || 0;

    return NextResponse.json({
      progress: progress || [],
      summary: {
        total,
        completed,
        inProgress,
        pending: total - completed - inProgress,
        totalInserted,
        allCompleted: total > 0 && completed === total,
      },
    });
  } catch (error) {
    console.error('Failed to fetch scrape progress:', error);
    return NextResponse.json(
      { error: String(error), progress: [] },
      { status: 500 }
    );
  }
}
