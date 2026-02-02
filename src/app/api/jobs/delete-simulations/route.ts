import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * シミュレーション結果を全件削除
 */
export async function POST() {
  const supabase = await createSupabaseServer();

  try {
    // simulation_monthlies を先に削除（外部キー制約）
    const { error: monthlyError } = await supabase
      .from('simulation_monthlies')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // 全件削除のためダミー条件

    if (monthlyError) {
      console.error('Failed to delete simulation_monthlies:', monthlyError);
    }

    // simulations を削除
    const { data: deleted, error: simError } = await supabase
      .from('simulations')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('id');

    if (simError) {
      throw new Error(`Failed to delete simulations: ${simError.message}`);
    }

    return NextResponse.json({
      success: true,
      deleted: deleted?.length || 0,
    });
  } catch (error) {
    console.error('Delete simulations failed:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
