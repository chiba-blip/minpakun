import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';

/**
 * Scheduled Function: 毎時スクレイプ（初回取得用）
 * 全エリアが完了するまで毎時実行
 */
export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  console.log('[scheduled-scrape] Starting...');
  
  const baseUrl = process.env.URL || 'http://localhost:3000';
  
  try {
    // バッチスクレイプAPIを呼び出し
    const response = await fetch(`${baseUrl}/api/jobs/scrape-batch?site=athome&mode=initial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    console.log('[scheduled-scrape] Result:', JSON.stringify(result, null, 2));

    // 全エリア完了チェック
    if (result.completed) {
      console.log('[scheduled-scrape] All areas completed!');
      // 完了後は週1回の差分スクレイプに移行
      // （netlify.tomlのスケジュール設定で制御）
    }

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('[scheduled-scrape] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};
