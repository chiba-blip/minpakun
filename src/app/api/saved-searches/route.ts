import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = await createSupabaseServer();
  
  const { data, error } = await supabase
    .from('saved_searches')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const body = await request.json();
  
  const {
    name,
    multiple,
    areas,
    property_types,
    price_min,
    price_max,
    walk_minutes_max,
    built_year_min,
    building_area_min,
    building_area_max,
    cleaning_fee_per_reservation,
    ota_fee_rate,
    management_fee_rate,
    other_cost_rate,
    enabled,
  } = body;

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('saved_searches')
    .insert({
      name,
      multiple: multiple ?? 7,
      areas: areas || null,
      property_types: property_types || null,
      price_min: price_min || null,
      price_max: price_max || null,
      walk_minutes_max: walk_minutes_max || null,
      built_year_min: built_year_min || null,
      building_area_min: building_area_min || null,
      building_area_max: building_area_max || null,
      cleaning_fee_per_reservation: cleaning_fee_per_reservation ?? 10000,
      ota_fee_rate: ota_fee_rate ?? 15,
      management_fee_rate: management_fee_rate ?? 20,
      other_cost_rate: other_cost_rate ?? 5,
      enabled: enabled ?? true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const body = await request.json();
  const { id, ...updateFields } = body;

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  // undefined以外のフィールドのみ更新
  const updateData: Record<string, unknown> = {};
  const allowedFields = [
    'name', 'multiple', 'areas', 'property_types', 'enabled',
    'price_min', 'price_max', 'walk_minutes_max', 'built_year_min',
    'building_area_min', 'building_area_max',
    'cleaning_fee_per_reservation', 'ota_fee_rate', 'management_fee_rate', 'other_cost_rate',
  ];

  for (const field of allowedFields) {
    if (updateFields[field] !== undefined) {
      updateData[field] = updateFields[field];
    }
  }

  const { data, error } = await supabase
    .from('saved_searches')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('saved_searches')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
