import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * 全物件データを削除
 */
export async function POST() {
  const supabase = await createSupabaseServer();

  try {
    // 削除順序（外部キー制約のため）
    // 1. simulation_monthlies
    // 2. simulations
    // 3. listings
    // 4. properties

    const { error: monthlyError } = await supabase
      .from('simulation_monthlies')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // 全件削除

    if (monthlyError) {
      console.error('Error deleting simulation_monthlies:', monthlyError);
    }

    const { error: simError } = await supabase
      .from('simulations')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (simError) {
      console.error('Error deleting simulations:', simError);
    }

    const { error: listingError } = await supabase
      .from('listings')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (listingError) {
      console.error('Error deleting listings:', listingError);
    }

    const { error: propError } = await supabase
      .from('properties')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (propError) {
      console.error('Error deleting properties:', propError);
    }

    return NextResponse.json({
      success: true,
      message: '全物件データを削除しました',
    });
  } catch (error) {
    console.error('Delete all failed:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
