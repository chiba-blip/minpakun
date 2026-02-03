import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';

/**
 * Scheduled Function: 毎時シミュレーション
 * スクレイプ完了後の物件をシミュレート
 */
export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  console.log('[scheduled-simulate] Starting...');
  
  const baseUrl = process.env.URL || 'http://localhost:3000';
  
  try {
    const response = await fetch(`${baseUrl}/api/jobs/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    console.log('[scheduled-simulate] Result:', JSON.stringify(result, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('[scheduled-simulate] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};
