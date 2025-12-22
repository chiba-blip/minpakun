import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';

// 物件一覧取得
export async function GET() {
  try {
    const supabase = createServerClient();
    
    const { data, error } = await supabase
      .from('properties')
      .select(`
        *,
        cost_profiles (*)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch properties:', error);
      return NextResponse.json(
        { success: false, error: '物件一覧の取得に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Properties API error:', error);
    return NextResponse.json(
      { success: false, error: 'リクエストの処理に失敗しました' },
      { status: 500 }
    );
  }
}

// 物件作成
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const supabase = createServerClient();

    // トランザクション的に物件と費用プロファイルを作成
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .insert({
        name: body.name,
        address_text: body.address,
        capacity: body.capacity,
        layout_text: body.layoutText,
        bedrooms: body.bedrooms || null,
        bathrooms: body.bathrooms || null,
        description: body.description || null,
      })
      .select()
      .single();

    if (propertyError || !property) {
      console.error('Failed to create property:', propertyError);
      return NextResponse.json(
        { success: false, error: '物件の作成に失敗しました' },
        { status: 500 }
      );
    }

    // 費用プロファイルを作成
    const cost = body.cost;
    const { error: costError } = await supabase
      .from('cost_profiles')
      .insert({
        property_id: property.id,
        ota_fee_rate: cost.otaFeeRate,
        cleaning_cost_per_turnover: cost.cleaningCostPerTurnover,
        linen_cost_per_turnover: cost.linenCostPerTurnover,
        consumables_cost_per_night: cost.consumablesCostPerNight || 0,
        utilities_cost_per_month: cost.utilitiesCostPerMonth || 0,
        management_fee_rate: cost.managementFeeRate || 0,
        avg_stay_nights: cost.avgStayNights || 2.0,
        other_fixed_cost_per_month: cost.otherFixedCostPerMonth || 0,
      });

    if (costError) {
      console.error('Failed to create cost profile:', costError);
      // 物件は作成されているので、エラーだがIDは返す
    }

    return NextResponse.json({
      success: true,
      propertyId: property.id,
    });

  } catch (error) {
    console.error('Properties API error:', error);
    return NextResponse.json(
      { success: false, error: 'リクエストの処理に失敗しました' },
      { status: 500 }
    );
  }
}

