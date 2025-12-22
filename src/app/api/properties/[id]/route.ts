import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';

type RouteContext = {
  params: Promise<{ id: string }>;
};

// 物件詳細取得
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const supabase = createServerClient();

    const { data: property, error } = await supabase
      .from('properties')
      .select(`
        *,
        cost_profiles (*),
        estimates (*)
      `)
      .eq('id', id)
      .single();

    if (error || !property) {
      return NextResponse.json(
        { success: false, error: '物件が見つかりません' },
        { status: 404 }
      );
    }

    // 最新の成功した見積もりを取得
    const { data: latestEstimate } = await supabase
      .from('estimates')
      .select('*')
      .eq('property_id', id)
      .eq('status', 'ok')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      success: true,
      data: {
        ...property,
        latest_estimate: latestEstimate,
      },
    });
  } catch (error) {
    console.error('Property API error:', error);
    return NextResponse.json(
      { success: false, error: 'リクエストの処理に失敗しました' },
      { status: 500 }
    );
  }
}

// 物件削除
export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const supabase = createServerClient();

    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json(
        { success: false, error: '物件の削除に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Property API error:', error);
    return NextResponse.json(
      { success: false, error: 'リクエストの処理に失敗しました' },
      { status: 500 }
    );
  }
}

