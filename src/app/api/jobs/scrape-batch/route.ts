import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { getConnector } from '@/lib/scraper/connectors';
import type { NormalizedListing } from '@/lib/scraper/types';
import { throttle } from '@/lib/scraper/http';
import { getAthomeSearchUrl, ATHOME_AREA_SLUGS } from '@/lib/constants';

// 設定
const ITEMS_PER_PAGE = 30;           // アットホームの1ページあたり件数（推定）
const MAX_ITEMS_PER_RUN = 200;       // 1回の実行で処理する最大件数
const MAX_TIME_MS = 14 * 60 * 1000;  // 14分（15分タイムアウト前に終了）
const CONSECUTIVE_SKIP_THRESHOLD = 10; // 差分モード: 連続スキップでこの数に達したら終了

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
 * - 進捗管理付き
 * - エリア指定検索URL
 * - 差分モード対応（既存連続スキップで終了）
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  
  // パラメータ
  const targetSite = searchParams.get('site') || 'athome';
  const forceReset = searchParams.get('reset') === 'true'; // 進捗リセット
  const mode = (searchParams.get('mode') || 'initial') as 'initial' | 'incremental';

  const results = {
    site: targetSite,
    areas_processed: [] as string[],
    total_processed: 0,
    total_inserted: 0,
    total_skipped: 0,
    errors: [] as string[],
    debug: [] as string[],  // デバッグ情報
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

    if (!scrapeConfig?.areas || scrapeConfig.areas.length === 0) {
      results.message = 'スクレイプ条件が設定されていません。設定画面でエリアを指定してください。';
      return NextResponse.json(results);
    }

    const targetAreas: string[] = scrapeConfig.areas;
    console.log(`[scrape-batch] Target areas: ${targetAreas.join(', ')}`);

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

    // 4. 進捗リセット（指定時）
    if (forceReset) {
      await supabase
        .from('scrape_progress')
        .delete()
        .eq('site_key', targetSite);
      console.log(`[scrape-batch] Progress reset for ${targetSite}`);
    }

    // 5. 各エリアを順番に処理
    let totalItemsProcessed = 0;

    for (const areaName of targetAreas) {
      // 時間チェック
      if (Date.now() - startTime > MAX_TIME_MS) {
        console.log(`[scrape-batch] Time limit reached`);
        break;
      }

      // アイテム数チェック
      if (totalItemsProcessed >= MAX_ITEMS_PER_RUN) {
        console.log(`[scrape-batch] Item limit reached`);
        break;
      }

      // エリアのURLスラッグを取得
      const areaSlug = ATHOME_AREA_SLUGS[areaName];
      if (!areaSlug) {
        console.log(`[scrape-batch] No slug for area: ${areaName}`);
        continue;
      }

      // 進捗を取得または作成
      let progress = await getOrCreateProgress(supabase, targetSite, areaSlug, areaName, mode);
      
      // 完了済みエリアはスキップ（差分モードでは毎回リセット）
      if (progress.status === 'completed' && mode === 'initial') {
        console.log(`[scrape-batch] Area already completed: ${areaName}`);
        continue;
      }

      // 進捗を処理中に更新
      await updateProgress(supabase, progress.id, {
        status: 'in_progress',
        started_at: progress.status !== 'in_progress' ? new Date().toISOString() : undefined,
      });

      console.log(`[scrape-batch] Processing area: ${areaName} (page ${progress.current_page})`);

      // ページを順次処理
      let areaCompleted = false;
      while (!areaCompleted) {
        // 制限チェック
        if (Date.now() - startTime > MAX_TIME_MS || totalItemsProcessed >= MAX_ITEMS_PER_RUN) {
          break;
        }

        const searchUrl = getAthomeSearchUrl(areaName, progress.current_page);
        if (!searchUrl) break;

        try {
          console.log(`[scrape-batch] Fetching: ${searchUrl}`);
          results.debug.push(`Fetching: ${searchUrl}`);
          
          const candidates = await connector.search({ 
            areas: [areaName], 
            propertyTypes: [], 
            maxPages: 1,
            customUrl: searchUrl,
          });

          results.debug.push(`${areaName} page ${progress.current_page}: ${candidates.length} candidates found`);
          console.log(`[scrape-batch] ${areaName} page ${progress.current_page}: ${candidates.length} candidates`);

          if (candidates.length === 0) {
            // ページに物件がない = 最終ページ到達
            areaCompleted = true;
            await updateProgress(supabase, progress.id, {
              status: 'completed',
              completed_at: new Date().toISOString(),
              total_pages: progress.current_page - 1,
            });
            results.debug.push(`${areaName}: completed (no more candidates)`);
            console.log(`[scrape-batch] Area completed: ${areaName}`);
            break;
          }

          // 各物件を処理
          for (const candidate of candidates) {
            if (Date.now() - startTime > MAX_TIME_MS || totalItemsProcessed >= MAX_ITEMS_PER_RUN) {
              break;
            }

            totalItemsProcessed++;
            progress.processed_count++;

            // 既存チェック
            const { data: existing } = await supabase
              .from('listings')
              .select('id')
              .eq('url', candidate.url)
              .maybeSingle();

            if (existing) {
              progress.skipped_count++;
              progress.consecutive_skips++;

              // 差分モード: 連続スキップで終了
              if (mode === 'incremental' && progress.consecutive_skips >= CONSECUTIVE_SKIP_THRESHOLD) {
                console.log(`[scrape-batch] Consecutive skips threshold reached for ${areaName}`);
                areaCompleted = true;
                await updateProgress(supabase, progress.id, {
                  status: 'completed',
                  completed_at: new Date().toISOString(),
                  consecutive_skips: progress.consecutive_skips,
                  skipped_count: progress.skipped_count,
                });
                break;
              }
              continue;
            }

            // 新規物件 → 連続スキップをリセット
            progress.consecutive_skips = 0;

            try {
              // 詳細取得
              const detail = await connector.fetchDetail(candidate.url);
              const normalized = connector.normalize(detail);

              // 保存
              await saveListing(supabase, site.id, normalized);
              progress.inserted_count++;
              results.total_inserted++;
              console.log(`[scrape-batch] Inserted: ${normalized.title?.substring(0, 30)}...`);

              await throttle(300);
            } catch (detailError) {
              console.error(`[scrape-batch] Detail error: ${candidate.url}`, detailError);
              results.errors.push(`${candidate.url}: ${detailError}`);
            }
          }

          // ページ進捗を保存
          progress.current_page++;
          await updateProgress(supabase, progress.id, {
            current_page: progress.current_page,
            processed_count: progress.processed_count,
            inserted_count: progress.inserted_count,
            skipped_count: progress.skipped_count,
            consecutive_skips: progress.consecutive_skips,
            last_run_at: new Date().toISOString(),
          });

        } catch (pageError) {
          console.error(`[scrape-batch] Page error: ${searchUrl}`, pageError);
          results.errors.push(`${searchUrl}: ${pageError}`);
          await updateProgress(supabase, progress.id, {
            status: 'error',
            error_message: String(pageError),
          });
          break;
        }
      }

      results.areas_processed.push(areaName);
      results.total_processed += progress.processed_count;
      results.total_skipped += progress.skipped_count;
    }

    // 全エリア完了チェック
    const { data: allProgress } = await supabase
      .from('scrape_progress')
      .select('status')
      .eq('site_key', targetSite);
    
    const allCompleted = allProgress?.every(p => p.status === 'completed') ?? false;
    results.completed = allCompleted;

    results.message = allCompleted
      ? `全エリアのスクレイプが完了しました（${results.total_inserted}件取得）`
      : `${results.areas_processed.length}エリア処理、${results.total_inserted}件取得（継続中）`;

    return NextResponse.json(results);

  } catch (error) {
    console.error('[scrape-batch] Failed:', error);
    const errorMessage = error instanceof Error 
      ? error.message 
      : typeof error === 'object' 
        ? JSON.stringify(error) 
        : String(error);
    
    // テーブルが存在しない場合の特別なメッセージ
    if (errorMessage.includes('does not exist') || errorMessage.includes('42P01')) {
      return NextResponse.json(
        { ...results, error: 'scrape_progressテーブルが存在しません。Supabaseでマイグレーションを実行してください。' },
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      { ...results, error: errorMessage },
      { status: 500 }
    );
  }
}

// 進捗を取得または作成
async function getOrCreateProgress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
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
