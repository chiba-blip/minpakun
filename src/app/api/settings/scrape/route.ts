import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = await createSupabaseServer();
  
  // enabled=trueのレコードを取得（Background Functionと同じ条件）
  const { data, error } = await supabase
    .from('scrape_configs')
    .select('*')
    .eq('enabled', true)
    .limit(1)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const body = await request.json();
  const { id, enabled, areas, property_types } = body;

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (enabled !== undefined) updateData.enabled = enabled;
  if (areas !== undefined) updateData.areas = areas;
  if (property_types !== undefined) updateData.property_types = property_types;

  const { data, error } = await supabase
    .from('scrape_configs')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
