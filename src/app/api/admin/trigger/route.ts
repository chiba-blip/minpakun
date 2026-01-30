import { NextRequest, NextResponse } from 'next/server';

/**
 * 管理者用手動トリガー（開発/デバッグ用）
 * 本番環境ではNetlify Functionsを直接呼び出す
 */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const job = searchParams.get('job');

  if (!job || !['scrape', 'simulate', 'notify'].includes(job)) {
    return NextResponse.json(
      { error: 'Invalid job parameter. Use: scrape, simulate, notify' },
      { status: 400 }
    );
  }

  // Netlify環境では直接Functionを呼び出す
  const netlifyFunctionsUrl = process.env.NETLIFY_FUNCTIONS_URL || '/.netlify/functions';
  
  try {
    // 開発環境ではモック応答
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV] Would trigger job: ${job}`);
      return NextResponse.json({ 
        message: `Job ${job} triggered (dev mode - no actual execution)`,
        job,
      });
    }

    // 本番環境ではNetlify Functionを呼び出す
    const response = await fetch(`${netlifyFunctionsUrl}/admin-trigger?job=${job}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.ADMIN_TRIGGER_TOKEN || ''}`,
      },
    });

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error(`Failed to trigger ${job}:`, error);
    return NextResponse.json(
      { error: `Failed to trigger ${job}: ${error}` },
      { status: 500 }
    );
  }
}
