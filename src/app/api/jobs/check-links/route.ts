import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

// 設定
const MAX_CHECKS_PER_RUN = 100;      // 1回の実行でチェックする最大件数
const MAX_TIME_MS = 14 * 60 * 1000;  // 14分

/**
 * リンク切れチェックジョブ
 * 掲載終了した物件を自動削除
 */
export async function POST() {
  const supabase = await createSupabaseServer();
  const startTime = Date.now();

  const results = {
    checked: 0,
    deleted: 0,
    errors: [] as string[],
    message: '',
  };

  try {
    // 最も古くチェックされた物件から順に取得
    // link_checked_at がnullまたは古い順
    const { data: listings, error } = await supabase
      .from('listings')
      .select('id, url, scraped_at')
      .order('scraped_at', { ascending: true })
      .limit(MAX_CHECKS_PER_RUN);

    if (error) {
      throw new Error(`Failed to fetch listings: ${error.message}`);
    }

    if (!listings || listings.length === 0) {
      results.message = 'チェック対象の物件がありません';
      return NextResponse.json(results);
    }

    for (const listing of listings) {
      // 時間チェック
      if (Date.now() - startTime > MAX_TIME_MS) {
        break;
      }

      results.checked++;

      try {
        // URLにアクセスしてステータスコードをチェック
        const response = await fetch(listing.url, {
          method: 'HEAD',
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MinpakuBot/1.0)',
          },
        });

        // 404 or リダイレクトで別ページに飛ぶ場合は削除
        const isDeleted = response.status === 404 || response.status === 410;
        
        // レスポンスのURLが元のURLと大きく異なる場合も削除対象
        // （売却済みページへリダイレクトされるケース）
        const finalUrl = response.url;
        const urlChanged = !finalUrl.includes('/kodate/') || 
                          finalUrl.includes('soldout') || 
                          finalUrl.includes('not_found');

        if (isDeleted || urlChanged) {
          console.log(`[check-links] Deleting: ${listing.url} (status: ${response.status}, redirect: ${urlChanged})`);
          
          // 関連データを削除（cascade設定により自動削除される場合もある）
          // 1. simulation_monthlies（simulationsのcascadeで削除される）
          // 2. simulations
          await supabase
            .from('simulations')
            .delete()
            .eq('listing_id', listing.id);

          // 3. listing
          await supabase
            .from('listings')
            .delete()
            .eq('id', listing.id);

          results.deleted++;
        }

        // レート制限のため少し待機
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (fetchError) {
        // ネットワークエラーなどは一時的な問題の可能性があるのでスキップ
        console.error(`[check-links] Fetch error for ${listing.url}:`, fetchError);
        results.errors.push(`${listing.url}: ${fetchError}`);
      }
    }

    results.message = `${results.checked}件チェック、${results.deleted}件削除`;
    return NextResponse.json(results);

  } catch (error) {
    console.error('[check-links] Failed:', error);
    return NextResponse.json(
      { ...results, error: String(error) },
      { status: 500 }
    );
  }
}
