import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { getConnector } from '@/lib/scraper/connectors';
import type { SearchParams, NormalizedListing } from '@/lib/scraper/types';
import { throttle } from '@/lib/scraper/http';

// Netlifyタイムアウト対策: 1サイト1ページ5件のみ処理
const MAX_PAGES = 1;
const MAX_DETAILS = 5;

/**
 * スクレイピングジョブ（タイムアウト対策版）
 * クエリパラメータでサイトを指定: ?site=athome
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { searchParams } = new URL(request.url);
  const targetSite = searchParams.get('site') || 'athome'; // デフォルトはアットホーム

  const results = {
    site: targetSite,
    processed: 0,
    inserted: 0,
    skipped: 0,
    errors: [] as string[],
    message: '',
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
      results.message = `ポータルサイト「${targetSite}」が見つからないか無効です`;
      return NextResponse.json(results);
    }

    // 2. スクレイプ条件を取得（エリアフィルタリング用）
    const { data: scrapeConfig } = await supabase
      .from('scrape_configs')
      .select('areas')
      .eq('enabled', true)
      .limit(1)
      .single();
    
    const targetAreas: string[] = scrapeConfig?.areas || [];
    console.log(`[scrape] Target areas: ${targetAreas.length > 0 ? targetAreas.join(', ') : 'ALL'}`);

    // 3. Connector取得
    const connector = getConnector(targetSite);
    if (!connector) {
      results.message = `コネクタ「${targetSite}」が見つかりません`;
      return NextResponse.json(results);
    }

    console.log(`[scrape] Starting: ${connector.name} (${targetSite})`);

    // 4. 検索実行（1ページのみ）
    const searchConfig: SearchParams = {
      areas: targetAreas,
      propertyTypes: [],
      maxPages: MAX_PAGES,
    };

    const candidates = await connector.search(searchConfig);
    console.log(`[scrape] Found ${candidates.length} candidates`);

    // 5. 詳細取得（5件のみ）
    const candidatesToProcess = candidates.slice(0, MAX_DETAILS);
    let areaFiltered = 0;

    for (const candidate of candidatesToProcess) {
      results.processed++;
      try {
        // 既存チェック（maybeSingleを使用 - 0件でもエラーにならない）
        const { data: existing, error: checkError } = await supabase
          .from('listings')
          .select('id')
          .eq('url', candidate.url)
          .maybeSingle();

        console.log(`[scrape] Check URL: ${candidate.url}, existing: ${!!existing}, error: ${checkError?.message || 'none'}`);

        if (existing) {
          results.skipped++;
          console.log(`[scrape] Skip (exists): ${candidate.url}`);
          continue;
        }

        // 詳細取得
        console.log(`[scrape] Fetching detail: ${candidate.url}`);
        const detail = await connector.fetchDetail(candidate.url);
        const normalized = connector.normalize(detail);
        
        // エリアフィルタリング: 対象エリアが設定されている場合、住所をチェック
        if (targetAreas.length > 0) {
          const address = normalized.property.address_raw;
          // 住所が取得できない場合も除外（エリア判定できないため）
          if (!address) {
            areaFiltered++;
            console.log(`[scrape] Skip (no address): ${candidate.url}`);
            continue;
          }
          const matchesArea = targetAreas.some(area => address.includes(area));
          if (!matchesArea) {
            areaFiltered++;
            console.log(`[scrape] Skip (area mismatch): ${address}`);
            continue;
          }
        }
        
        await saveListing(supabase, site.id, normalized);
        results.inserted++;
        console.log(`[scrape] Inserted: ${normalized.title?.substring(0, 30)}...`);

        await throttle(300);
      } catch (error) {
        results.errors.push(String(error));
        console.error(`[scrape] Error: ${candidate.url}`, error);
      }
    }
    
    if (areaFiltered > 0) {
      console.log(`[scrape] Area filtered: ${areaFiltered} items`);
    }

    results.message = `${connector.name}: ${results.inserted}件取得、${results.skipped}件スキップ（候補${candidates.length}件中${candidatesToProcess.length}件処理）`;
    console.log(`[scrape] Done: ${results.message}`);

    return NextResponse.json(results);
  } catch (error) {
    console.error('[scrape] Failed:', error);
    return NextResponse.json(
      { ...results, error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * リスティングをDBに保存
 */
async function saveListing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  portalSiteId: string,
  listing: NormalizedListing
) {
  // 1. property を検索 or 作成
  let propertyId: string;

  // 既存の物件を住所で検索（address_raw を優先、なければ normalized_address）
  let existingProperty = null;
  
  // まず address_raw で検索（より正確）
  if (listing.property.address_raw) {
    const { data } = await supabase
      .from('properties')
      .select('id')
      .eq('address_raw', listing.property.address_raw)
      .maybeSingle();
    existingProperty = data;
  }
  
  // address_raw で見つからない場合、normalized_address で検索（空文字は除外）
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

  console.log(`Saved: ${listing.title?.substring(0, 30)}...`);
}
