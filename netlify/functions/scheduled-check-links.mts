import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';

/**
 * Scheduled Function: 週1回のリンク切れチェック
 * 掲載終了物件を自動削除
 */
export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  console.log('[scheduled-check-links] Starting...');
  
  const baseUrl = process.env.URL || 'http://localhost:3000';
  
  try {
    const response = await fetch(`${baseUrl}/api/jobs/check-links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    console.log('[scheduled-check-links] Result:', JSON.stringify(result, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('[scheduled-check-links] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};
