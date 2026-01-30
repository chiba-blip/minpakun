import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * 開発環境用のスクレイピングジョブ
 * 本番環境ではNetlify Scheduled Functionsを使用
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();

  const results = {
    processed: 0,
    inserted: 0,
    errors: [] as string[],
    message: '',
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

    // 3. デモデータを挿入（実際のスクレイピングの代わり）
    // ※実際のスクレイピングは利用規約の確認が必要なため、デモデータを使用
    const demoProperties = generateDemoProperties(configs.areas, configs.property_types);

    for (const demo of demoProperties) {
      results.processed++;

      try {
        // 物件を作成
        const { data: property, error: propError } = await supabase
          .from('properties')
          .insert({
            normalized_address: demo.address,
            city: demo.city,
            address_raw: demo.address,
            building_area: demo.building_area,
            land_area: demo.land_area,
            built_year: demo.built_year,
            rooms: demo.rooms,
            property_type: demo.property_type,
          })
          .select('id')
          .single();

        if (propError) {
          results.errors.push(`物件作成失敗: ${propError.message}`);
          continue;
        }

        // 最初の有効なサイトでリスティングを作成
        const siteId = sites[0].id;
        const { error: listingError } = await supabase
          .from('listings')
          .insert({
            portal_site_id: siteId,
            property_id: property.id,
            url: demo.url,
            title: demo.title,
            price: demo.price,
            external_id: demo.external_id,
            raw: { demo: true },
          });

        if (listingError) {
          if (!listingError.message.includes('duplicate')) {
            results.errors.push(`リスティング作成失敗: ${listingError.message}`);
          }
          continue;
        }

        results.inserted++;
      } catch (error) {
        results.errors.push(`エラー: ${error}`);
      }
    }

    results.message = `${results.inserted}件の物件を取得しました`;
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
 * デモ用の物件データを生成
 */
function generateDemoProperties(areas: string[], propertyTypes: string[]) {
  const properties = [];
  const now = Date.now();

  // 各エリア×物件タイプで1〜3件生成
  for (const area of areas) {
    for (const type of propertyTypes) {
      const count = Math.floor(Math.random() * 3) + 1;
      
      for (let i = 0; i < count; i++) {
        const isApartment = type.includes('集合');
        const price = isApartment 
          ? Math.floor(Math.random() * 50000000) + 30000000  // 3000万〜8000万
          : Math.floor(Math.random() * 20000000) + 5000000;   // 500万〜2500万
        
        const buildingArea = isApartment
          ? Math.floor(Math.random() * 300) + 200  // 200〜500㎡
          : Math.floor(Math.random() * 100) + 80;   // 80〜180㎡

        const rooms = isApartment
          ? Math.floor(Math.random() * 8) + 4  // 4〜12戸
          : 1;

        properties.push({
          title: `${area}の${type}物件 ${i + 1}`,
          address: `北海道${area}${Math.floor(Math.random() * 10) + 1}条${Math.floor(Math.random() * 20) + 1}丁目`,
          city: area.includes('札幌市') ? area : area,
          price,
          building_area: buildingArea,
          land_area: buildingArea * (Math.random() * 0.5 + 1),
          built_year: 2024 - Math.floor(Math.random() * 40),
          rooms,
          property_type: type,
          url: `https://example.com/property/${now}-${area}-${i}`,
          external_id: `demo-${now}-${area}-${i}`,
        });
      }
    }
  }

  return properties;
}
