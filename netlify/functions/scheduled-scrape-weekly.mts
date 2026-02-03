import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';

/**
 * Scheduled Function: 週1回の差分スクレイプ
 * 新着物件のみを取得（既存連続スキップで終了）
 */
export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  console.log('[scheduled-scrape-weekly] Starting incremental scrape...');
  
  const baseUrl = process.env.URL || 'http://localhost:3000';
  
  try {
    // 差分モードでバッチスクレイプAPIを呼び出し
    const response = await fetch(`${baseUrl}/api/jobs/scrape-batch?site=athome&mode=incremental`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    console.log('[scheduled-scrape-weekly] Result:', JSON.stringify(result, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('[scheduled-scrape-weekly] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};
