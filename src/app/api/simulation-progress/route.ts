import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = await createSupabaseServer();
  
  try {
    const { data, error } = await supabase
      .from('simulation_progress')
      .select('*')
      .eq('id', 'current')
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned
      throw error;
    }

    return NextResponse.json(data || {
      status: 'idle',
      processed: 0,
      total: 0,
      message: null,
      updated_at: null,
    });
  } catch (error) {
    console.error('Failed to fetch simulation progress:', error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
