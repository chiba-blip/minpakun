/**
 * スクレイピングジョブ
 * Netlify Scheduled Function: 6時間ごとに実行
 */
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase';
import { getConnectors } from './_shared/connectors/index';
import type { SearchParams, NormalizedListing } from './_shared/connectors/types';
import { logInfo, logError } from './_shared/log';
import { throttle } from './_shared/http';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  logInfo('jobs-scrape started');
  
  const supabase = getSupabaseAdmin();
  const results = {
    processed: 0,
    inserted: 0,
    errors: [] as string[],
  };

  try {
    // 1. 有効なポータルサイトを取得
    const { data: sites, error: sitesError } = await supabase
      .from('portal_sites')
      .select('*')
      .eq('enabled', true);

    if (sitesError) {
      throw new Error(`Failed to fetch portal_sites: ${sitesError.message}`);
    }

    if (!sites || sites.length === 0) {
      logInfo('No enabled portal sites');
      return { statusCode: 200, body: JSON.stringify({ message: 'No enabled sites' }) };
    }

    // 2. スクレイプ設定を取得
    const { data: configs, error: configError } = await supabase
      .from('scrape_configs')
      .select('*')
      .eq('enabled', true)
      .limit(1)
      .single();

    if (configError || !configs) {
      throw new Error(`Failed to fetch scrape_configs: ${configError?.message}`);
    }

    const searchParams: SearchParams = {
      areas: configs.areas || [],
      propertyTypes: configs.property_types || [],
      maxPages: 3, // 初期は控えめに
    };

    // 3. 各サイトのConnectorで検索・取得
    const enabledKeys = sites.map(s => s.key);
    const connectors = getConnectors(enabledKeys);

    for (const connector of connectors) {
      const site = sites.find(s => s.key === connector.key);
      if (!site) continue;

      logInfo(`Processing site: ${connector.name}`, { key: connector.key });

      try {
        // 検索実行
        const candidates = await connector.search(searchParams);
        logInfo(`Found ${candidates.length} candidates`, { site: connector.key });

        // 各候補の詳細を取得
        for (const candidate of candidates) {
          results.processed++;

          try {
            // 既存チェック（URL重複）
            const { data: existing } = await supabase
              .from('listings')
              .select('id')
              .eq('url', candidate.url)
              .single();

            if (existing) {
              logInfo(`Skipping existing listing`, { url: candidate.url });
              continue;
            }

            // 詳細取得
            const detail = await connector.fetchDetail(candidate.url);
            const normalized = connector.normalize(detail);

            // DB保存
            await saveListing(supabase, site.id, normalized);
            results.inserted++;

            await throttle(1000);
          } catch (error) {
            const msg = `Error processing ${candidate.url}: ${error}`;
            logError(msg);
            results.errors.push(msg);
          }
        }
      } catch (error) {
        const msg = `Error searching ${connector.key}: ${error}`;
        logError(msg);
        results.errors.push(msg);
      }
    }

    logInfo('jobs-scrape completed', results);

    return {
      statusCode: 200,
      body: JSON.stringify(results),
    };
  } catch (error) {
    logError('jobs-scrape failed', { error: String(error) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};

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

  // 既存の物件を住所で検索
  const { data: existingProperty } = await supabase
    .from('properties')
    .select('id')
    .eq('normalized_address', listing.property.normalized_address)
    .single();

  if (existingProperty) {
    propertyId = existingProperty.id;
  } else {
    // 新規作成
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

  if (listingError) {
    // 重複エラーは無視
    if (!listingError.message.includes('duplicate')) {
      throw new Error(`Failed to insert listing: ${listingError.message}`);
    }
  }

  logInfo('Saved listing', { url: listing.url, propertyId });
}

// Netlify Scheduled Function設定
// netlify.toml に以下を追加:
// [functions."jobs-scrape"]
//   schedule = "0 */6 * * *"  # 6時間ごと
