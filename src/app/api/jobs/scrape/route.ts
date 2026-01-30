import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { getConnectors } from '@/lib/scraper/connectors';
import type { SearchParams, NormalizedListing } from '@/lib/scraper/types';
import { throttle } from '@/lib/scraper/http';

/**
 * スクレイピングジョブ
 * 全ポータルサイトから物件を取得
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();

  const results = {
    processed: 0,
    inserted: 0,
    skipped: 0,
    errors: [] as string[],
    message: '',
    details: {} as Record<string, { candidates: number; inserted: number }>,
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
      results.message = '有効なポータルサイトがありません。設定 → ポータルサイトで有効にしてください。';
      return NextResponse.json(results);
    }

    // 2. スクレイプ設定を取得
    const { data: configs, error: configError } = await supabase
      .from('scrape_configs')
      .select('*')
      .eq('enabled', true)
      .limit(1)
      .single();

    if (configError || !configs) {
      results.message = 'スクレイプ条件が設定されていません。設定 → スクレイプ条件で設定してください。';
      return NextResponse.json(results);
    }

    const searchParams: SearchParams = {
      areas: configs.areas || [],
      propertyTypes: configs.property_types || [],
      maxPages: 200, // 十分な数のページを取得（SUUMOは82ページ等）
    };

    console.log('Search params:', searchParams);
    console.log('Enabled sites:', sites.map(s => s.key));

    // 3. 各サイトのConnectorで検索・取得
    const enabledKeys = sites.map(s => s.key);
    const connectors = getConnectors(enabledKeys);

    console.log('Active connectors:', connectors.map(c => c.key));

    for (const connector of connectors) {
      const site = sites.find(s => s.key === connector.key);
      if (!site) continue;

      console.log(`\n=== Processing site: ${connector.name} (${connector.key}) ===`);
      results.details[connector.key] = { candidates: 0, inserted: 0 };

      try {
        // 検索実行（全ページ取得）
        const candidates = await connector.search(searchParams);
        results.details[connector.key].candidates = candidates.length;
        console.log(`Found ${candidates.length} candidates from ${connector.name}`);

        // 各候補の詳細を取得（1サイトあたり最大2000件）
        const maxDetailsPerSite = 2000;
        const candidatesToProcess = candidates.slice(0, maxDetailsPerSite);

        for (const candidate of candidatesToProcess) {
          results.processed++;

          try {
            // 既存チェック（URL重複）
            const { data: existing } = await supabase
              .from('listings')
              .select('id')
              .eq('url', candidate.url)
              .single();

            if (existing) {
              results.skipped++;
              continue;
            }

            // 詳細取得
            const detail = await connector.fetchDetail(candidate.url);
            const normalized = connector.normalize(detail);

            // DB保存
            await saveListing(supabase, site.id, normalized);
            results.inserted++;
            results.details[connector.key].inserted++;

            await throttle(500);
          } catch (error) {
            const msg = `Error processing ${candidate.url}: ${error}`;
            console.error(msg);
            results.errors.push(msg);
          }
        }

        if (candidates.length > maxDetailsPerSite) {
          console.log(`Note: Processed ${maxDetailsPerSite} of ${candidates.length} candidates`);
        }
      } catch (error) {
        const msg = `Error searching ${connector.key}: ${error}`;
        console.error(msg);
        results.errors.push(msg);
      }
    }

    results.message = `${results.inserted}件の新規物件を取得しました（${results.skipped}件はスキップ）`;
    console.log('\n=== Scrape completed ===');
    console.log(results);

    return NextResponse.json(results);
  } catch (error) {
    console.error('Scrape job failed:', error);
    return NextResponse.json(
      { error: String(error), ...results },
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

  console.log(`Saved: ${listing.title?.substring(0, 30)}...`);
}
