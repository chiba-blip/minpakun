import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { getConnector } from '@/lib/scraper/connectors';
import type { NormalizedListing } from '@/lib/scraper/types';
import { throttle, fetchHtml } from '@/lib/scraper/http';
import { getAthomeSearchUrl, ATHOME_AREA_SLUGS } from '@/lib/constants';

// 設定（Netlify Functionsのタイムアウト対策）
const MAX_ITEMS_PER_RUN = 5;         // 1回の実行で処理する最大件数（タイムアウト対策）
const MAX_TIME_MS = 8 * 1000;        // 8秒（Netlifyのデフォルト10秒以内）
const CONSECUTIVE_SKIP_THRESHOLD = 20;

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
 * - エリア指定検索URL（効率100%）
 * - 進捗管理付き
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  
  const targetSite = searchParams.get('site') || 'athome';
  const forceReset = searchParams.get('reset') === 'true';
  const mode = (searchParams.get('mode') || 'initial') as 'initial' | 'incremental';

  const results = {
    site: targetSite,
    mode,
    target_areas: [] as string[],
    current_area: '',
    current_page: 0,
    candidates_found: 0,
    total_processed: 0,
    total_inserted: 0,
    total_skipped: 0,
    debug: [] as string[],
    errors: [] as string[],
    message: '',
    completed: false,
  };

  try {
    // 1. スクレイプ条件を取得
    const { data: scrapeConfig } = await supabase
      .from('scrape_configs')
      .select('areas, property_types')
      .eq('enabled', true)
      .limit(1)
      .single();

    const targetAreas: string[] = scrapeConfig?.areas || [];
    results.target_areas = targetAreas;

    if (targetAreas.length === 0) {
      results.message = 'スクレイプ条件が設定されていません';
      return NextResponse.json(results);
    }

    results.debug.push(`Target areas: ${targetAreas.join(', ')}`);

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

    // 4. 進捗リセット
    if (forceReset) {
      await supabase.from('scrape_progress').delete().eq('site_key', targetSite);
      results.debug.push('Progress reset');
    }

    // 5. 各エリアを処理
    let totalItemsProcessed = 0;

    for (const areaName of targetAreas) {
      if (Date.now() - startTime > MAX_TIME_MS || totalItemsProcessed >= MAX_ITEMS_PER_RUN) {
        results.debug.push(`Limit reached: time=${Date.now() - startTime}ms, items=${totalItemsProcessed}`);
        break;
      }

      // エリアのURLスラッグを確認
      const areaSlug = ATHOME_AREA_SLUGS[areaName];
      if (!areaSlug) {
        results.debug.push(`No slug for: ${areaName}`);
        continue;
      }

      // 進捗を取得または作成
      let progress = await getOrCreateProgress(supabase, targetSite, areaSlug, areaName, mode);
      
      if (progress.status === 'completed' && mode === 'initial') {
        results.debug.push(`${areaName}: already completed`);
        continue;
      }

      results.current_area = areaName;
      results.current_page = progress.current_page;

      // 進捗を処理中に更新
      await updateProgress(supabase, progress.id, { status: 'in_progress' });

      // ページを処理
      let areaCompleted = false;
      let consecutiveSkips = 0;

      while (!areaCompleted && totalItemsProcessed < MAX_ITEMS_PER_RUN) {
        if (Date.now() - startTime > MAX_TIME_MS) break;

        // エリア指定検索URL
        const searchUrl = getAthomeSearchUrl(areaName, progress.current_page);
        if (!searchUrl) {
          results.debug.push(`${areaName}: no URL for page ${progress.current_page}`);
          break;
        }

        results.debug.push(`Fetching: ${searchUrl}`);

        try {
          // HTMLを直接取得してパターンマッチ（コネクターをバイパス）
          const html = await fetchHtml(searchUrl);
          results.debug.push(`HTML length: ${html.length}`);

          // 物件IDを抽出
          const pattern = /\/kodate\/(\d{10})(?:\/|\?)/g;
          const candidates: string[] = [];
          for (const m of html.matchAll(pattern)) {
            const url = `https://www.athome.co.jp/kodate/${m[1]}/`;
            if (!candidates.includes(url)) {
              candidates.push(url);
            }
          }

          results.debug.push(`${areaName} page ${progress.current_page}: ${candidates.length} candidates`);
          results.candidates_found += candidates.length;

          if (candidates.length === 0) {
            areaCompleted = true;
            await updateProgress(supabase, progress.id, {
              status: 'completed',
              completed_at: new Date().toISOString(),
              total_pages: progress.current_page - 1,
            });
            results.debug.push(`${areaName}: completed (no more)`);
            break;
          }

          // 各候補を処理
          for (const url of candidates) {
            if (totalItemsProcessed >= MAX_ITEMS_PER_RUN || Date.now() - startTime > MAX_TIME_MS) {
              break;
            }

            // 既存チェック
            const { data: existing } = await supabase
              .from('listings')
              .select('id')
              .eq('url', url)
              .maybeSingle();

            if (existing) {
              results.total_skipped++;
              consecutiveSkips++;

              if (mode === 'incremental' && consecutiveSkips >= CONSECUTIVE_SKIP_THRESHOLD) {
                areaCompleted = true;
                await updateProgress(supabase, progress.id, { status: 'completed' });
                results.debug.push(`${areaName}: skips threshold`);
                break;
              }
              continue;
            }

            consecutiveSkips = 0;
            totalItemsProcessed++;
            results.total_processed++;

            try {
              const detail = await connector.fetchDetail(url);
              const normalized = connector.normalize(detail);
              await saveListing(supabase, site.id, normalized);
              results.total_inserted++;
              await throttle(500);
            } catch (detailError) {
              results.errors.push(`${url}: ${detailError}`);
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

          await throttle(1000);

        } catch (pageError) {
          results.errors.push(`Page error: ${pageError}`);
          results.debug.push(`Page error: ${pageError}`);
          break;
        }
      }
    }

    // 全エリア完了チェック
    const { data: allProgress } = await supabase
      .from('scrape_progress')
      .select('status')
      .eq('site_key', targetSite);
    
    const completedCount = allProgress?.filter(p => p.status === 'completed').length || 0;
    const totalCount = allProgress?.length || 0;
    results.completed = totalCount > 0 && completedCount === totalCount;

    results.message = results.completed
      ? `全エリア完了: ${results.total_inserted}件取得`
      : `${results.total_inserted}件取得（${completedCount}/${totalCount}エリア完了）`;

    return NextResponse.json(results);

  } catch (error) {
    console.error('[scrape-batch] Failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ...results, error: errorMessage }, { status: 500 });
  }
}

async function getOrCreateProgress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  siteKey: string,
  areaKey: string,
  areaName: string,
  mode: string
): Promise<ScrapeProgress> {
  const { data: existing, error: selectError } = await supabase
    .from('scrape_progress')
    .select('*')
    .eq('site_key', siteKey)
    .eq('area_key', areaKey)
    .maybeSingle();

  // エラーがあっても無視（レコードなしの場合もある）
  if (selectError) {
    console.log(`[getOrCreateProgress] Select error (ignored): ${selectError.message}`);
  }

  if (existing) {
    if (mode === 'incremental' && existing.status === 'completed') {
      await supabase.from('scrape_progress').update({
        current_page: 1, processed_count: 0, inserted_count: 0,
        skipped_count: 0, consecutive_skips: 0, status: 'pending', mode: 'incremental',
      }).eq('id', existing.id);
      return { ...existing, current_page: 1, status: 'pending' };
    }
    return existing;
  }

  const { data: newProgress, error } = await supabase
    .from('scrape_progress')
    .insert({ site_key: siteKey, area_key: areaKey, area_name: areaName, current_page: 1, mode })
    .select('*')
    .single();

  if (error) throw error;
  return newProgress;
}

async function updateProgress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  progressId: string,
  updates: Partial<ScrapeProgress> & { completed_at?: string; last_run_at?: string }
) {
  await supabase.from('scrape_progress').update(updates).eq('id', progressId);
}

async function saveListing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  portalSiteId: string,
  listing: NormalizedListing
) {
  let propertyId: string;
  let existingProperty = null;

  if (listing.property.address_raw) {
    const { data } = await supabase.from('properties').select('id')
      .eq('address_raw', listing.property.address_raw).maybeSingle();
    existingProperty = data;
  }

  const normalizedAddress = listing.property?.normalized_address;
  if (!existingProperty && normalizedAddress && normalizedAddress.length > 10) {
    const { data } = await supabase.from('properties').select('id')
      .eq('normalized_address', listing.property.normalized_address).maybeSingle();
    existingProperty = data;
  }

  if (existingProperty) {
    propertyId = existingProperty.id;
  } else {
    const { data: newProperty, error } = await supabase.from('properties').insert({
      normalized_address: listing.property.normalized_address,
      city: listing.property.city,
      address_raw: listing.property.address_raw,
      building_area: listing.property.building_area,
      land_area: listing.property.land_area,
      built_year: listing.property.built_year,
      rooms: listing.property.rooms,
      property_type: listing.property.property_type,
    }).select('id').single();
    if (error) throw error;
    propertyId = newProperty.id;
  }

  const { error } = await supabase.from('listings').insert({
    portal_site_id: portalSiteId, property_id: propertyId,
    url: listing.url, title: listing.title, price: listing.price,
    external_id: listing.external_id, raw: listing.raw,
  });
  if (error && !error.message.includes('duplicate')) throw error;
}
