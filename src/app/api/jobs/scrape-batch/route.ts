import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { getConnector } from '@/lib/scraper/connectors';
import type { NormalizedListing } from '@/lib/scraper/types';
import { throttle } from '@/lib/scraper/http';

// 設定
const MAX_ITEMS_PER_RUN = 50;        // 1回の実行で処理する最大件数（詳細取得が重いので少なめ）
const MAX_TIME_MS = 13 * 60 * 1000;  // 13分（15分タイムアウト前に終了）
const CONSECUTIVE_SKIP_THRESHOLD = 30; // 差分モード: 連続スキップでこの数に達したら終了

interface ScrapeProgress {
  id: string;
  site_key: string;
  area_key: string;
  area_name: string;
  current_page: number;
  total_pages: number | null;
  processed_count: number;
  inserted_count: number;
  skipped_count: number;
  consecutive_skips: number;
  status: string;
  mode: string;
  error_message: string | null;
}

/**
 * バッチスクレイプジョブ
 * - 北海道全体URLからページネーションで取得
 * - 住所でエリアフィルタリング
 * - 進捗管理付き（ページ単位）
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  
  // パラメータ
  const targetSite = searchParams.get('site') || 'athome';
  const forceReset = searchParams.get('reset') === 'true';
  const mode = (searchParams.get('mode') || 'initial') as 'initial' | 'incremental';

  const results = {
    site: targetSite,
    mode,
    current_page: 0,
    candidates_found: 0,
    total_processed: 0,
    total_inserted: 0,
    total_skipped: 0,
    area_filtered: 0,
    errors: [] as string[],
    message: '',
    completed: false,
  };

  try {
    // 1. スクレイプ条件を取得（エリアフィルタ用）
    const { data: scrapeConfig } = await supabase
      .from('scrape_configs')
      .select('areas, property_types')
      .eq('enabled', true)
      .limit(1)
      .single();

    const targetAreas: string[] = scrapeConfig?.areas || [];
    console.log(`[scrape-batch] Target areas: ${targetAreas.length > 0 ? targetAreas.join(', ') : 'ALL'}`);

    if (targetAreas.length === 0) {
      results.message = 'スクレイプ条件が設定されていません。設定画面でエリアを指定してください。';
      return NextResponse.json(results);
    }

    // 2. ポータルサイト確認
    const { data: site, error: siteError } = await supabase
      .from('portal_sites')
      .select('id')
      .eq('key', targetSite)
      .single();

    if (siteError || !site) {
      results.message = `ポータルサイト「${targetSite}」が見つかりません`;
      return NextResponse.json(results);
    }

    // 3. コネクター取得
    const connector = getConnector(targetSite);
    if (!connector) {
      results.message = `コネクタ「${targetSite}」が見つかりません`;
      return NextResponse.json(results);
    }

    // 4. 進捗を取得または作成（サイト全体で1レコード）
    let progress = await getOrCreateProgress(supabase, targetSite, mode, forceReset);
    results.current_page = progress.current_page;

    // 完了済みの場合はスキップ（差分モードでは毎回リセット）
    if (progress.status === 'completed' && mode === 'initial') {
      results.message = '全ページのスクレイプが完了しています。進捗リセットで最初から取得できます。';
      results.completed = true;
      return NextResponse.json(results);
    }

    // 進捗を処理中に更新
    await updateProgress(supabase, progress.id, {
      status: 'in_progress',
      started_at: progress.status !== 'in_progress' ? new Date().toISOString() : undefined,
    });

    // 5. ページを順次処理
    let itemsProcessed = 0;
    let consecutiveSkips = 0;

    while (itemsProcessed < MAX_ITEMS_PER_RUN) {
      // 時間チェック
      if (Date.now() - startTime > MAX_TIME_MS) {
        console.log(`[scrape-batch] Time limit reached at page ${progress.current_page}`);
        break;
      }

      // 差分モード: 連続スキップで終了
      if (mode === 'incremental' && consecutiveSkips >= CONSECUTIVE_SKIP_THRESHOLD) {
        console.log(`[scrape-batch] Consecutive skips threshold reached`);
        await updateProgress(supabase, progress.id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        });
        results.completed = true;
        break;
      }

      // ページから候補を取得（コネクターのsearchを1ページ分だけ呼ぶ）
      const pageUrl = getPageUrl(targetSite, progress.current_page);
      console.log(`[scrape-batch] Fetching page ${progress.current_page}: ${pageUrl}`);

      try {
        const candidates = await connector.search({
          areas: [],
          propertyTypes: [],
          maxPages: 1,
          customUrl: pageUrl,
        });

        results.candidates_found += candidates.length;
        console.log(`[scrape-batch] Page ${progress.current_page}: ${candidates.length} candidates`);

        if (candidates.length === 0) {
          // 最終ページ到達
          console.log(`[scrape-batch] No more candidates, scraping completed`);
          await updateProgress(supabase, progress.id, {
            status: 'completed',
            completed_at: new Date().toISOString(),
            total_pages: progress.current_page - 1,
          });
          results.completed = true;
          break;
        }

        // 各候補を処理
        for (const candidate of candidates) {
          if (itemsProcessed >= MAX_ITEMS_PER_RUN || Date.now() - startTime > MAX_TIME_MS) {
            break;
          }

          // 既存チェック
          const { data: existing } = await supabase
            .from('listings')
            .select('id')
            .eq('url', candidate.url)
            .maybeSingle();

          if (existing) {
            results.total_skipped++;
            consecutiveSkips++;
            continue;
          }

          // 新規物件 → 連続スキップをリセット
          consecutiveSkips = 0;
          itemsProcessed++;
          results.total_processed++;

          try {
            // 詳細取得
            const detail = await connector.fetchDetail(candidate.url);
            const normalized = connector.normalize(detail);

            // エリアフィルタリング
            const address = normalized.property.address_raw;
            if (!address) {
              results.area_filtered++;
              console.log(`[scrape-batch] Filtered (no address): ${candidate.url}`);
              continue;
            }

            const matchesArea = targetAreas.some(area => address.includes(area));
            if (!matchesArea) {
              results.area_filtered++;
              console.log(`[scrape-batch] Filtered (area mismatch): ${address}`);
              continue;
            }

            // 保存
            await saveListing(supabase, site.id, normalized);
            results.total_inserted++;
            console.log(`[scrape-batch] Inserted: ${normalized.title?.substring(0, 30)}...`);

            await throttle(500);
          } catch (detailError) {
            console.error(`[scrape-batch] Detail error: ${candidate.url}`, detailError);
            results.errors.push(`${candidate.url}: ${detailError}`);
          }
        }

        // 次のページへ
        progress.current_page++;
        await updateProgress(supabase, progress.id, {
          current_page: progress.current_page,
          processed_count: results.total_processed,
          inserted_count: results.total_inserted,
          skipped_count: results.total_skipped,
          last_run_at: new Date().toISOString(),
        });

      } catch (pageError) {
        console.error(`[scrape-batch] Page error:`, pageError);
        results.errors.push(`Page ${progress.current_page}: ${pageError}`);
        // エラーでも次のページへ進む
        progress.current_page++;
        await updateProgress(supabase, progress.id, {
          current_page: progress.current_page,
          error_message: String(pageError),
        });
      }
    }

    results.current_page = progress.current_page;
    results.message = results.completed
      ? `スクレイプ完了: ${results.total_inserted}件取得`
      : `${results.total_inserted}件取得（ページ${progress.current_page}まで処理、続きあり）`;

    return NextResponse.json(results);

  } catch (error) {
    console.error('[scrape-batch] Failed:', error);
    const errorMessage = error instanceof Error 
      ? error.message 
      : typeof error === 'object' 
        ? JSON.stringify(error) 
        : String(error);
    
    return NextResponse.json(
      { ...results, error: errorMessage },
      { status: 500 }
    );
  }
}

// ページURLを生成
function getPageUrl(siteKey: string, page: number): string {
  if (siteKey === 'athome') {
    const baseUrl = 'https://www.athome.co.jp/kodate/chuko/hokkaido';
    return page === 1 ? `${baseUrl}/list/` : `${baseUrl}/list/page${page}/`;
  }
  // 他のサイトは後で追加
  return '';
}

// 進捗を取得または作成
async function getOrCreateProgress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  siteKey: string,
  mode: string,
  forceReset: boolean
): Promise<ScrapeProgress> {
  // リセット
  if (forceReset) {
    await supabase
      .from('scrape_progress')
      .delete()
      .eq('site_key', siteKey);
    console.log(`[scrape-batch] Progress reset for ${siteKey}`);
  }

  const { data: existing } = await supabase
    .from('scrape_progress')
    .select('*')
    .eq('site_key', siteKey)
    .eq('area_key', 'all')  // サイト全体で1レコード
    .single();

  if (existing) {
    // 差分モードの場合はページをリセット
    if (mode === 'incremental' && existing.status === 'completed') {
      await supabase
        .from('scrape_progress')
        .update({
          current_page: 1,
          processed_count: 0,
          inserted_count: 0,
          skipped_count: 0,
          consecutive_skips: 0,
          status: 'pending',
          mode: 'incremental',
          error_message: null,
        })
        .eq('id', existing.id);
      
      return {
        ...existing,
        current_page: 1,
        processed_count: 0,
        inserted_count: 0,
        skipped_count: 0,
        consecutive_skips: 0,
        status: 'pending',
        mode: 'incremental',
      };
    }
    return existing;
  }

  // 新規作成
  const { data: newProgress, error } = await supabase
    .from('scrape_progress')
    .insert({
      site_key: siteKey,
      area_key: 'all',
      area_name: '北海道全域',
      current_page: 1,
      mode,
    })
    .select('*')
    .single();

  if (error) throw error;
  return newProgress;
}

// 進捗を更新
async function updateProgress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  progressId: string,
  updates: Partial<ScrapeProgress> & { started_at?: string; completed_at?: string; last_run_at?: string }
) {
  await supabase
    .from('scrape_progress')
    .update(updates)
    .eq('id', progressId);
}

// リスティングを保存
async function saveListing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  portalSiteId: string,
  listing: NormalizedListing
) {
  // 物件を検索または作成
  let propertyId: string;

  let existingProperty = null;
  if (listing.property.address_raw) {
    const { data } = await supabase
      .from('properties')
      .select('id')
      .eq('address_raw', listing.property.address_raw)
      .maybeSingle();
    existingProperty = data;
  }

  if (!existingProperty && listing.property.normalized_address && listing.property.normalized_address.length > 10) {
    const { data } = await supabase
      .from('properties')
      .select('id')
      .eq('normalized_address', listing.property.normalized_address)
      .maybeSingle();
    existingProperty = data;
  }

  if (existingProperty) {
    propertyId = existingProperty.id;
  } else {
    const { data: newProperty, error: propError } = await supabase
      .from('properties')
      .insert({
        normalized_address: listing.property.normalized_address,
        city: listing.property.city,
        address_raw: listing.property.address_raw,
        building_area: listing.property.building_area,
        land_area: listing.property.land_area,
        built_year: listing.property.built_year,
        rooms: listing.property.rooms,
        property_type: listing.property.property_type,
      })
      .select('id')
      .single();

    if (propError || !newProperty) {
      throw new Error(`Failed to insert property: ${propError?.message}`);
    }
    propertyId = newProperty.id;
  }

  // リスティングを作成
  const { error: listingError } = await supabase
    .from('listings')
    .insert({
      portal_site_id: portalSiteId,
      property_id: propertyId,
      url: listing.url,
      title: listing.title,
      price: listing.price,
      external_id: listing.external_id,
      raw: listing.raw,
    });

  if (listingError && !listingError.message.includes('duplicate')) {
    throw new Error(`Failed to insert listing: ${listingError.message}`);
  }
}
