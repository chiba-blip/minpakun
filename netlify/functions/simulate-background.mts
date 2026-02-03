/**
 * 大量シミュレーション用 Background Function
 * 最大15分間バックグラウンドで実行可能
 * 
 * Next.jsのAPIルート(/api/jobs/simulate)を繰り返し呼び出し、
 * AirROI APIを使用したシミュレーションを実行
 * 
 * 呼び出し: POST /.netlify/functions/simulate-background
 */
import { getSupabaseAdmin } from './_shared/supabase.mts';
import { logInfo, logError } from './_shared/log.mts';
import type { Handler, HandlerEvent } from '@netlify/functions';

// 15分の制限に対して余裕を持たせる（14分）
const MAX_TIME_MS = 14 * 60 * 1000;
// 各バッチ間の待機時間（AirROI APIレート制限対策）
const BATCH_INTERVAL_MS = 2000;

// 進捗状況テーブル更新
async function updateProgress(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  status: string,
  processed: number,
  total: number,
  message?: string
) {
  await supabase
    .from('simulation_progress')
    .upsert({
      id: 'current',
      status,
      processed,
      total,
      message: message || null,
      updated_at: new Date().toISOString(),
    });
}

// キャンセルチェック
async function isCancelled(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<boolean> {
  const { data } = await supabase
    .from('simulation_progress')
    .select('status')
    .eq('id', 'current')
    .eq('status', 'cancelled')
    .limit(1);
  return data && data.length > 0;
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const supabase = getSupabaseAdmin();
  const startTime = Date.now();
  const baseUrl = process.env.URL || 'http://localhost:3000';
  
  let totalSimulated = 0;
  let totalProcessed = 0;
  let offset = 0;
  const errors: string[] = [];

  try {
    logInfo('simulate-background', 'Starting background simulation with AirROI API');

    // シミュレーション未実行のリスティング数を取得
    const { count: totalCount } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .not('property_id', 'is', null);

    // 既存シミュレーション数を取得
    const { count: existingSimCount } = await supabase
      .from('simulations')
      .select('id', { count: 'exact', head: true });

    const remainingCount = (totalCount || 0) - Math.floor((existingSimCount || 0) / 3); // 3シナリオ分

    // 進捗を初期化
    await updateProgress(supabase, 'in_progress', 0, remainingCount, 'AirROI APIでシミュレーション開始');

    let hasMore = true;
    let loops = 0;
    const maxLoops = 500; // 無限ループ防止

    while (hasMore && loops < maxLoops && Date.now() - startTime < MAX_TIME_MS) {
      loops++;

      // キャンセルチェック
      if (await isCancelled(supabase)) {
        logInfo('simulate-background', 'Cancelled by user');
        await updateProgress(supabase, 'cancelled', totalProcessed, remainingCount, 'ユーザーによりキャンセル');
        break;
      }

      try {
        // Next.jsのAPIルートを呼び出し
        const response = await fetch(`${baseUrl}/api/jobs/simulate?offset=${offset}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          errors.push(`API error: ${response.status} - ${errorText}`);
          logError('simulate-background', `API error: ${response.status}`);
          break;
        }

        const result = await response.json();

        totalSimulated += result.simulated || 0;
        totalProcessed += result.processed || 0;

        // 進捗更新
        await updateProgress(
          supabase,
          'in_progress',
          totalProcessed,
          remainingCount,
          `${totalSimulated}件完了 (AirROI API使用)`
        );

        logInfo('simulate-background', `Batch ${loops}: simulated=${result.simulated}, processed=${result.processed}, has_more=${result.has_more}`);

        if (!result.has_more) {
          hasMore = false;
          break;
        }

        offset = result.next_offset || (offset + 200);

        // APIレート制限対策
        await new Promise(resolve => setTimeout(resolve, BATCH_INTERVAL_MS));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Fetch error: ${errorMessage}`);
        logError('simulate-background', `Fetch error: ${errorMessage}`);
        // 1回のエラーでは止めず、次のバッチを試す
        offset += 200;
        await new Promise(resolve => setTimeout(resolve, BATCH_INTERVAL_MS * 2));
      }
    }

    // 完了
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const message = `完了: ${totalSimulated}件シミュレーション (${elapsed}秒, AirROI API使用)`;
    await updateProgress(supabase, 'completed', totalProcessed, remainingCount, message);
    
    logInfo('simulate-background', `Completed: ${totalSimulated} simulations in ${elapsed}s`);

    return {
      statusCode: 202,
      body: JSON.stringify({
        success: true,
        simulated: totalSimulated,
        processed: totalProcessed,
        elapsed_seconds: elapsed,
        errors: errors.slice(0, 10),
      }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('simulate-background', `Failed: ${errorMessage}`);
    await updateProgress(supabase, 'error', totalProcessed, 0, errorMessage);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: errorMessage }),
    };
  }
};
