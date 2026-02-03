/**
 * 大量スクレイピング用 Background Function
 * 最大15分間バックグラウンドで実行可能
 * 
 * 呼び出し: POST /.netlify/functions/scrape-background?site=athome
 * 
 * Background Functionとして動作させるには netlify.toml で
 * [functions."scrape-background"]
 *   type = "background"
 * を設定する必要があります。
 */
import { getSupabaseAdmin } from './_shared/supabase.mts';
import { getConnector } from './_shared/connectors/index.mts';
import type { NormalizedListing } from './_shared/connectors/types.mts';
import { logInfo, logError } from './_shared/log.mts';
import { throttle, fetchHtml } from './_shared/http.mts';

// 15分の制限に対して余裕を持たせる（14分）
const MAX_TIME_MS = 14 * 60 * 1000;
const CONSECUTIVE_SKIP_THRESHOLD = 30;
const DETAIL_THROTTLE_MS = 800;
const PAGE_THROTTLE_MS = 3000;  // ページ間は3秒待機（ボット対策）

// キャンセルチェック用ヘルパー
async function isCancelled(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  siteKey: string
): Promise<boolean> {
  const { data } = await supabase
    .from('scrape_progress')
    .select('status')
    .eq('site_key', siteKey)
    .eq('status', 'cancelled')
    .limit(1);
  return data && data.length > 0;
}

// エリアスラッグ（アットホーム用）- constants.tsと統一
const ATHOME_AREA_SLUGS: Record<string, string> = {
  // 札幌市
  '札幌市': 'sapporo-city',
  '札幌市中央区': 'chuo-ku-sapporo-city',
  '札幌市北区': 'kita-ku-sapporo-city',
  '札幌市東区': 'higashi-ku-sapporo-city',
  '札幌市白石区': 'shiroishi-ku-sapporo-city',
  '札幌市豊平区': 'toyohira-ku-sapporo-city',
  '札幌市南区': 'minami-ku-sapporo-city',
  '札幌市西区': 'nishi-ku-sapporo-city',
  '札幌市厚別区': 'atsubetsu-ku-sapporo-city',
  '札幌市手稲区': 'teine-ku-sapporo-city',
  '札幌市清田区': 'kiyota-ku-sapporo-city',
  // 主要都市
  '小樽市': 'otaru-city',
  '旭川市': 'asahikawa-city',
  '函館市': 'hakodate-city',
  '釧路市': 'kushiro-city',
  '帯広市': 'obihiro-city',
  '北見市': 'kitami-city',
  '苫小牧市': 'tomakomai-city',
  '千歳市': 'chitose-city',
  '江別市': 'ebetsu-city',
  '室蘭市': 'muroran-city',
  '岩見沢市': 'iwamizawa-city',
  '恵庭市': 'eniwa-city',
  '北広島市': 'kitahiroshima-city',
  '石狩市': 'ishikari-city',
  '登別市': 'noboribetsu-city',
  // リゾート
  'ニセコ町': 'niseko-town-abuta-county',
  '倶知安町': 'kutchan-town-abuta-county',
  '余市町': 'yoichi-town-yoichi-county',
  '洞爺湖町': 'toyako-town-abuta-county',
  '留寿都村': 'rusutsu-village-abuta-county',
};

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

function getAthomeSearchUrl(areaName: string, page: number): string | null {
  const slug = ATHOME_AREA_SLUGS[areaName];
  if (!slug) return null;
  const baseUrl = 'https://www.athome.co.jp/kodate/chuko/hokkaido';
  if (page === 1) {
    return `${baseUrl}/${slug}/list/`;
  }
  // アットホームのページネーション形式: ?page=2, ?page=3
  return `${baseUrl}/${slug}/list/?page=${page}`;
}

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const targetSite = url.searchParams.get('site') || 'athome';
  const forceReset = url.searchParams.get('reset') === 'true';
  const mode = (url.searchParams.get('mode') || 'initial') as 'initial' | 'incremental';
  
  const startTime = Date.now();
  logInfo(`[scrape-background] Started: ${targetSite}, mode: ${mode}, reset: ${forceReset}`);
  
  const supabase = getSupabaseAdmin();
  
  const results = {
    site: targetSite,
    mode,
    total_processed: 0,
    total_inserted: 0,
    total_skipped: 0,
    areas_completed: 0,
    areas_total: 0,
    current_area: '',
    errors: [] as string[],
    startTime: new Date().toISOString(),
    endTime: '',
    completed: false,
    elapsed_seconds: 0,
  };

  try {
    // 1. 対象ポータルサイトを取得
    const { data: site, error: siteError } = await supabase
      .from('portal_sites')
      .select('*')
      .eq('key', targetSite)
      .eq('enabled', true)
      .single();

    if (siteError || !site) {
      throw new Error(`ポータルサイト「${targetSite}」が見つからないか無効です`);
    }

    // 2. スクレイプ条件を取得（最初のレコードを使用）
    const { data: scrapeConfig } = await supabase
      .from('scrape_configs')
      .select('areas, property_types, enabled')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    
    if (!scrapeConfig?.enabled) {
      throw new Error('スクレイプが無効化されています');
    }
    
    const targetAreas: string[] = scrapeConfig?.areas || [];
    results.areas_total = targetAreas.length;
    
    if (targetAreas.length === 0) {
      throw new Error('スクレイプ条件が設定されていません');
    }
    
    logInfo(`[scrape-background] Target areas: ${targetAreas.join(', ')}`);

    // 3. Connector取得
    const connector = getConnector(targetSite);
    if (!connector) {
      throw new Error(`コネクタ「${targetSite}」が見つかりません`);
    }

    // 4. 進捗リセット（必要に応じて）
    if (forceReset) {
      await supabase.from('scrape_progress').delete().eq('site_key', targetSite);
      logInfo('[scrape-background] Progress reset');
    }

    // 5. サイト別処理
    if (targetSite === 'hokkaido-rengotai') {
      // 北海道不動産連合隊: コネクターのsearchメソッドを使用
      await processRengotai(supabase, connector, site, targetAreas, scrapeConfig?.property_types || [], results, startTime, mode, forceReset);
    } else {
      // アットホーム: エリア別処理
      await processAthome(supabase, connector, site, targetAreas, results, startTime, mode, forceReset);
    }

    // 全エリア完了チェック
    const { data: allProgress } = await supabase
      .from('scrape_progress')
      .select('status')
      .eq('site_key', targetSite);
    
    const completedCount = allProgress?.filter((p: {status: string}) => p.status === 'completed').length || 0;
    const totalCount = allProgress?.length || 0;
    results.completed = totalCount > 0 && completedCount === totalCount;
    results.areas_completed = completedCount;
    results.areas_total = totalCount;

    results.endTime = new Date().toISOString();
    results.elapsed_seconds = Math.round((Date.now() - startTime) / 1000);

    logInfo(`[scrape-background] Finished`, results);

    return new Response(JSON.stringify({
      success: true,
      message: results.completed 
        ? `全エリア完了: ${results.total_inserted}件取得` 
        : `${results.total_inserted}件取得（${results.areas_completed}/${results.areas_total}エリア完了）`,
      ...results,
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    results.endTime = new Date().toISOString();
    results.elapsed_seconds = Math.round((Date.now() - startTime) / 1000);
    logError('[scrape-background] Failed', { error: String(error) });
    
    return new Response(JSON.stringify({
      success: false,
      error: String(error),
      ...results,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// 北海道不動産連合隊の処理
async function processRengotai(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  connector: ReturnType<typeof getConnector>,
  site: { id: string },
  targetAreas: string[],
  propertyTypes: string[],
  results: typeof globalThis.results,
  startTime: number,
  mode: string,
  forceReset: boolean
) {
  if (forceReset) {
    await supabase.from('scrape_progress').delete().eq('site_key', 'hokkaido-rengotai');
    logInfo('[scrape-background] Progress reset');
  }

  // 進捗を取得または作成
  let progress = await getOrCreateProgress(supabase, 'hokkaido-rengotai', 'all', '全体', mode);
  
  if (progress.status === 'completed' && mode === 'initial') {
    results.areas_completed = 1;
    results.areas_total = 1;
    logInfo('[scrape-background] Already completed');
    return;
  }

  await updateProgress(supabase, progress.id, { status: 'in_progress' });

  // コネクターのsearchメソッドで候補を取得
  const types = propertyTypes.length > 0 ? propertyTypes : ['一戸建て'];
  logInfo(`[scrape-background] Searching with types: ${types.join(', ')}`);

  try {
    const candidates = await connector!.search({
      areas: targetAreas,
      propertyTypes: types,
      maxPages: 50, // 最大50ページ
    });

    logInfo(`[scrape-background] Found ${candidates.length} candidates`);
    results.areas_total = 1;

    let consecutiveSkips = 0;

    for (const candidate of candidates) {
      // キャンセルチェック
      if (await isCancelled(supabase, 'hokkaido-rengotai')) {
        logInfo('[scrape-background] Cancelled by user');
        await updateProgress(supabase, progress.id, { status: 'cancelled' });
        return;
      }

      if (Date.now() - startTime > MAX_TIME_MS) {
        logInfo('[scrape-background] Time limit reached');
        break;
      }

      results.total_processed++;

      // 既存チェック
      const { data: existing } = await supabase
        .from('listings')
        .select('id')
        .eq('url', candidate.url)
        .maybeSingle();

      if (existing) {
        results.total_skipped++;
        consecutiveSkips++;
        if (mode === 'incremental' && consecutiveSkips >= CONSECUTIVE_SKIP_THRESHOLD) {
          logInfo('[scrape-background] Consecutive skips threshold reached');
          break;
        }
        continue;
      }

      consecutiveSkips = 0;

      try {
        const detail = await connector!.fetchDetail(candidate.url);
        const normalized = connector!.normalize(detail);
        
        // エリアフィルター
        if (targetAreas.length > 0 && normalized.property.city) {
          const matchesArea = targetAreas.some(area => 
            normalized.property.city?.includes(area) || 
            normalized.property.address_raw?.includes(area)
          );
          if (!matchesArea) {
            logInfo(`[scrape-background] Skipping (area mismatch): ${normalized.property.city}`);
            continue;
          }
        }

        logInfo(`[scrape-background] Saving: ${normalized.title}, city: ${normalized.property.city}`);
        await saveListing(supabase, site.id, normalized);
        results.total_inserted++;
        await throttle(DETAIL_THROTTLE_MS);
      } catch (detailError) {
        results.errors.push(`${candidate.url}: ${detailError}`);
        logError('[scrape-background] Detail error', { url: candidate.url, error: String(detailError) });
      }
    }

    // 完了
    await updateProgress(supabase, progress.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      inserted_count: results.total_inserted,
      skipped_count: results.total_skipped,
    });
    results.areas_completed = 1;

  } catch (searchError) {
    logError('[scrape-background] Search error', { error: String(searchError) });
    results.errors.push(`Search error: ${searchError}`);
  }
}

// アットホームの処理
async function processAthome(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  connector: ReturnType<typeof getConnector>,
  site: { id: string },
  targetAreas: string[],
  results: typeof globalThis.results,
  startTime: number,
  mode: string,
  forceReset: boolean
) {
  if (forceReset) {
    await supabase.from('scrape_progress').delete().eq('site_key', 'athome');
    logInfo('[scrape-background] Progress reset');
  }

  for (const areaName of targetAreas) {
      // キャンセルチェック
      if (await isCancelled(supabase, 'athome')) {
        logInfo('[scrape-background] Cancelled by user');
        return;
      }

      // 時間チェック
      if (Date.now() - startTime > MAX_TIME_MS) {
        logInfo(`[scrape-background] Time limit reached: ${Math.round((Date.now() - startTime) / 1000)}s`);
        break;
      }

      const areaSlug = ATHOME_AREA_SLUGS[areaName];
      if (!areaSlug) {
        logInfo(`[scrape-background] No slug for: ${areaName}`);
        continue;
      }

      // 進捗を取得または作成
      let progress = await getOrCreateProgress(supabase, 'athome', areaSlug, areaName, mode);
      
      if (progress.status === 'completed' && mode === 'initial') {
        results.areas_completed++;
        logInfo(`[scrape-background] ${areaName}: already completed`);
        continue;
      }

      results.current_area = areaName;
      await updateProgress(supabase, progress.id, { status: 'in_progress' });
      logInfo(`[scrape-background] Processing: ${areaName} from page ${progress.current_page}`);

      // ページを処理
      let areaCompleted = false;
      let consecutiveSkips = 0;
      let areaInserted = 0;
      let areaSkipped = 0;

      while (!areaCompleted) {
        // 時間チェック
        if (Date.now() - startTime > MAX_TIME_MS) {
          logInfo(`[scrape-background] Time limit during ${areaName}`);
          break;
        }

        // エリア指定検索URL
        const searchUrl = getAthomeSearchUrl(areaName, progress.current_page);
        if (!searchUrl) {
          logInfo(`[scrape-background] ${areaName}: no URL for page ${progress.current_page}`);
          break;
        }

        try {
          logInfo(`[scrape-background] Fetching URL: ${searchUrl}`);
          
          // Refererを設定（ボット対策回避）
          const referer = progress.current_page === 1 
            ? 'https://www.athome.co.jp/kodate/chuko/hokkaido/'
            : getAthomeSearchUrl(areaName, progress.current_page - 1) || 'https://www.athome.co.jp/';
          
          // HTMLを取得
          const html = await fetchHtml(searchUrl, {
            headers: {
              'Referer': referer,
              'Cookie': 'SERVERID=a; samesite=Lax',
            }
          });
          
          logInfo(`[scrape-background] HTML length: ${html.length}, URL: ${searchUrl}`);
          
          // 短いHTMLの場合は内容を確認
          if (html.length < 50000) {
            logInfo(`[scrape-background] Short HTML content: ${html.substring(0, 500).replace(/\s+/g, ' ')}`);
          }
          
          // 物件IDを抽出（複数のパターンを試す）
          const pattern1 = /\/kodate\/(\d{10})(?:\/|\?)/g;
          const pattern2 = /data-bukken-id="(\d+)"/g;
          const pattern3 = /kodate\/(\d{7,12})/g;
          
          const candidates: string[] = [];
          
          // パターン1
          for (const m of html.matchAll(pattern1)) {
            const candidateUrl = `https://www.athome.co.jp/kodate/${m[1]}/`;
            if (!candidates.includes(candidateUrl)) {
              candidates.push(candidateUrl);
            }
          }
          
          // パターン1で見つからない場合、パターン3を試す
          if (candidates.length === 0) {
            for (const m of html.matchAll(pattern3)) {
              const candidateUrl = `https://www.athome.co.jp/kodate/${m[1]}/`;
              if (!candidates.includes(candidateUrl)) {
                candidates.push(candidateUrl);
              }
            }
          }

          logInfo(`[scrape-background] ${areaName} page ${progress.current_page}: ${candidates.length} candidates`);

          if (candidates.length === 0) {
            areaCompleted = true;
            await updateProgress(supabase, progress.id, {
              status: 'completed',
              completed_at: new Date().toISOString(),
              total_pages: progress.current_page - 1,
            });
            results.areas_completed++;
            logInfo(`[scrape-background] ${areaName}: completed (no more candidates)`);
            break;
          }

          // 各候補を処理
          for (const candidateUrl of candidates) {
            // 時間チェック
            if (Date.now() - startTime > MAX_TIME_MS) break;

            results.total_processed++;

            // 既存チェック
            const { data: existing } = await supabase
              .from('listings')
              .select('id')
              .eq('url', candidateUrl)
              .maybeSingle();

            if (existing) {
              results.total_skipped++;
              areaSkipped++;
              consecutiveSkips++;

              if (mode === 'incremental' && consecutiveSkips >= CONSECUTIVE_SKIP_THRESHOLD) {
                areaCompleted = true;
                await updateProgress(supabase, progress.id, { status: 'completed' });
                results.areas_completed++;
                logInfo(`[scrape-background] ${areaName}: completed (consecutive skips threshold)`);
                break;
              }
              continue;
            }

            consecutiveSkips = 0;

            try {
              const detail = await connector.fetchDetail(candidateUrl);
              const normalized = connector.normalize(detail);
              logInfo(`[scrape-background] Saving: ${normalized.title || candidateUrl}, price: ${normalized.price}, city: ${normalized.property.city}`);
              await saveListing(supabase, site.id, normalized);
              results.total_inserted++;
              areaInserted++;
              logInfo(`[scrape-background] Saved successfully: ${candidateUrl}`);
              await throttle(DETAIL_THROTTLE_MS);
            } catch (detailError) {
              results.errors.push(`${candidateUrl}: ${detailError}`);
              logError(`[scrape-background] Detail/Save error: ${candidateUrl}`, { error: String(detailError) });
            }
          }

          // 次のページ
          progress.current_page++;
          await updateProgress(supabase, progress.id, {
            current_page: progress.current_page,
            processed_count: results.total_processed,
            inserted_count: results.total_inserted,
            skipped_count: results.total_skipped,
            last_run_at: new Date().toISOString(),
          });

          await throttle(PAGE_THROTTLE_MS);

        } catch (pageError) {
          results.errors.push(`Page error ${areaName} p${progress.current_page}: ${pageError}`);
          logError(`[scrape-background] Page error`, { area: areaName, page: progress.current_page, error: String(pageError) });
          break;
        }
      }

      logInfo(`[scrape-background] ${areaName}: inserted=${areaInserted}, skipped=${areaSkipped}`);
  }
}

async function getOrCreateProgress(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  siteKey: string,
  areaKey: string,
  areaName: string,
  mode: string
): Promise<ScrapeProgress> {
  const { data: existing } = await supabase
    .from('scrape_progress')
    .select('*')
    .eq('site_key', siteKey)
    .eq('area_key', areaKey)
    .maybeSingle();

  if (existing) {
    if (mode === 'incremental' && existing.status === 'completed') {
      await supabase.from('scrape_progress').update({
        current_page: 1,
        processed_count: 0,
        inserted_count: 0,
        skipped_count: 0,
        consecutive_skips: 0,
        status: 'pending',
        mode: 'incremental',
      }).eq('id', existing.id);
      return { ...existing, current_page: 1, status: 'pending' };
    }
    return existing;
  }

  const { data: newProgress, error } = await supabase
    .from('scrape_progress')
    .insert({
      site_key: siteKey,
      area_key: areaKey,
      area_name: areaName,
      current_page: 1,
      mode,
    })
    .select('*')
    .single();

  if (error) throw error;
  return newProgress;
}

async function updateProgress(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  progressId: string,
  updates: Partial<ScrapeProgress> & { completed_at?: string; last_run_at?: string }
) {
  await supabase.from('scrape_progress').update(updates).eq('id', progressId);
}

async function saveListing(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  portalSiteId: string,
  listing: NormalizedListing
) {
  let propertyId: string;
  let existingProperty = null;

  logInfo(`[saveListing] Starting: ${listing.url}`);

  // 住所が十分に具体的な場合のみ既存propertyを検索
  // 「北海道」だけや短い住所では検索しない
  const hasSpecificAddress = listing.property.address_raw && 
    listing.property.address_raw.length > 15 &&
    /\d/.test(listing.property.address_raw); // 番地が含まれている

  if (hasSpecificAddress) {
    const { data, error } = await supabase
      .from('properties')
      .select('id')
      .eq('address_raw', listing.property.address_raw)
      .maybeSingle();
    if (error) logError(`[saveListing] Error searching by address_raw`, { error: error.message });
    existingProperty = data;
  }

  if (existingProperty) {
    propertyId = existingProperty.id;
    logInfo(`[saveListing] Using existing property: ${propertyId}, updating nearest_station: ${listing.property.nearest_station}`);
    
    // 既存物件のnearest_stationとwalk_minutesを更新
    if (listing.property.nearest_station || listing.property.walk_minutes) {
      const { error: updateError } = await supabase
        .from('properties')
        .update({
          nearest_station: listing.property.nearest_station,
          walk_minutes: listing.property.walk_minutes,
        })
        .eq('id', propertyId);
      
      if (updateError) {
        logError(`[saveListing] Failed to update nearest_station`, { error: updateError.message });
      }
    }
  } else {
    logInfo(`[saveListing] Creating new property with nearest_station: ${listing.property.nearest_station}, walk_minutes: ${listing.property.walk_minutes}`);
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
        nearest_station: listing.property.nearest_station,
        walk_minutes: listing.property.walk_minutes,
      })
      .select('id')
      .single();

    if (propError || !newProperty) {
      logError(`[saveListing] Failed to insert property`, { error: propError?.message, listing: listing.property });
      throw new Error(`Failed to insert property: ${propError?.message}`);
    }

    propertyId = newProperty.id;
    logInfo(`[saveListing] Created property: ${propertyId}`);
  }

  logInfo(`[saveListing] Inserting listing for property ${propertyId}...`);
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
