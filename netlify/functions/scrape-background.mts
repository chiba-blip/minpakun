/**
 * 大量スクレイピング用 Background Function
 * 最大15分間バックグラウンドで実行可能
 * 
 * 呼び出し: POST /.netlify/functions/scrape-background?site=athome
 */
import type { Config } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase.mts';
import { getConnector } from './_shared/connectors/index.mts';
import type { SearchParams, NormalizedListing } from './_shared/connectors/types.mts';
import { logInfo, logError } from './_shared/log.mts';
import { throttle } from './_shared/http.mts';

// Background Function設定
export const config: Config = {
  path: '/.netlify/functions/scrape-background',
};

// 大量スクレイピング設定（15分で最大2000件処理可能）
const MAX_PAGES = 100;    // 最大100ページ（1ページ30件 = 最大3000件の候補）
const MAX_DETAILS = 2000; // 最大2000件の詳細取得
const SEARCH_THROTTLE_MS = 1500; // 検索ページ: 1.5秒間隔
const DETAIL_THROTTLE_MS = 300;  // 詳細ページ: 0.3秒間隔（15分で約2000件処理可能）

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const targetSite = url.searchParams.get('site') || 'athome';
  
  logInfo(`[scrape-background] Started: ${targetSite}`);
  
  const supabase = getSupabaseAdmin();
  const results = {
    site: targetSite,
    processed: 0,
    inserted: 0,
    skipped: 0,
    areaFiltered: 0,
    errors: [] as string[],
    startTime: new Date().toISOString(),
    endTime: '',
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

    // 2. スクレイプ条件を取得
    const { data: scrapeConfig } = await supabase
      .from('scrape_configs')
      .select('areas')
      .eq('enabled', true)
      .limit(1)
      .single();
    
    const targetAreas: string[] = scrapeConfig?.areas || [];
    logInfo(`[scrape-background] Target areas: ${targetAreas.length > 0 ? targetAreas.join(', ') : 'ALL'}`);

    // 3. Connector取得
    const connector = getConnector(targetSite);
    if (!connector) {
      throw new Error(`コネクタ「${targetSite}」が見つかりません`);
    }

    logInfo(`[scrape-background] Using connector: ${connector.name}`);

    // 4. 検索実行（最大100ページ）
    const searchConfig: SearchParams = {
      areas: targetAreas,
      propertyTypes: [],
      maxPages: MAX_PAGES,
    };

    logInfo(`[scrape-background] Starting search with maxPages=${MAX_PAGES}`);
    const candidates = await connector.search(searchConfig);
    logInfo(`[scrape-background] Found ${candidates.length} candidates`);

    // 5. 詳細取得（最大2000件）
    const candidatesToProcess = candidates.slice(0, MAX_DETAILS);
    logInfo(`[scrape-background] Processing ${candidatesToProcess.length} items (throttle: ${DETAIL_THROTTLE_MS}ms)`);

    for (const candidate of candidatesToProcess) {
      results.processed++;

      try {
        // 既存チェック
        const { data: existing } = await supabase
          .from('listings')
          .select('id')
          .eq('url', candidate.url)
          .maybeSingle();

        if (existing) {
          results.skipped++;
          continue;
        }

        // 詳細取得
        const detail = await connector.fetchDetail(candidate.url);
        const normalized = connector.normalize(detail);

        // エリアフィルタリング
        if (targetAreas.length > 0 && normalized.property.address_raw) {
          const address = normalized.property.address_raw;
          const matchesArea = targetAreas.some(area => address.includes(area));
          if (!matchesArea) {
            results.areaFiltered++;
            continue;
          }
        }

        // DB保存
        await saveListing(supabase, site.id, normalized);
        results.inserted++;

        // 進捗ログ（100件ごと）
        if (results.processed % 100 === 0) {
          logInfo(`[scrape-background] Progress: ${results.processed}/${candidatesToProcess.length}, inserted: ${results.inserted}`);
        }

        await throttle(DETAIL_THROTTLE_MS);
      } catch (error) {
        results.errors.push(String(error));
        logError(`[scrape-background] Error: ${candidate.url}`, { error: String(error) });
      }
    }

    results.endTime = new Date().toISOString();
    logInfo(`[scrape-background] Completed`, results);

    return new Response(JSON.stringify({
      success: true,
      message: `${connector.name}: ${results.inserted}件取得、${results.skipped}件スキップ、${results.areaFiltered}件エリア外`,
      ...results,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    results.endTime = new Date().toISOString();
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

/**
 * リスティングをDBに保存
 */
async function saveListing(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  portalSiteId: string,
  listing: NormalizedListing
) {
  // 1. property を検索 or 作成
  let propertyId: string;

  const { data: existingProperty } = await supabase
    .from('properties')
    .select('id')
    .eq('normalized_address', listing.property.normalized_address)
    .maybeSingle();

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

  // 2. listing を作成
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
