import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = await createSupabaseServer();
  
  const { data, error } = await supabase
    .from('slack_configs')
    .select('*')
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows returned
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || { enabled: false, webhook_url: '' });
}

export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const body = await request.json();
  const { id, enabled, webhook_url } = body;

  // 既存レコードがある場合は更新、なければ作成
  if (id) {
    const updateData: Record<string, unknown> = {};
    if (enabled !== undefined) updateData.enabled = enabled;
    if (webhook_url !== undefined) updateData.webhook_url = webhook_url;

    const { data, error } = await supabase
      .from('slack_configs')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } else {
    // 新規作成
    const { data, error } = await supabase
      .from('slack_configs')
      .insert({ enabled: enabled ?? true, webhook_url })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const body = await request.json();
  const webhookUrl = body.webhook_url;

  if (!webhookUrl) {
    return NextResponse.json({ error: 'webhook_url is required' }, { status: 400 });
  }

  // テスト送信
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'みんぱくん: Slack通知テスト成功！',
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Webhook test failed' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
