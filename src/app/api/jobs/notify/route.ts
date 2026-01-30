import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

/**
 * 通知ジョブ
 * 保存検索条件に合致する新着物件をSlack通知
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();

  const results = {
    checked: 0,
    notified: 0,
    errors: [] as string[],
    message: '',
  };

  try {
    // Slack設定を取得
    const { data: slackConfig, error: slackError } = await supabase
      .from('slack_configs')
      .select('*')
      .eq('enabled', true)
      .limit(1)
      .single();

    if (slackError || !slackConfig?.webhook_url) {
      results.message = 'Slack通知が設定されていません。設定 → Slack通知で設定してください。';
      return NextResponse.json(results);
    }

    // 有効な保存検索を取得
    const { data: savedSearches, error: searchError } = await supabase
      .from('saved_searches')
      .select('*')
      .eq('enabled', true);

    if (searchError || !savedSearches || savedSearches.length === 0) {
      results.message = '有効な保存検索がありません。保存した検索条件で通知をONにしてください。';
      return NextResponse.json(results);
    }

    // 新着リスティングを取得（過去24時間）
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);

    const { data: newListings, error: listingsError } = await supabase
      .from('listings')
      .select(`
        id,
        url,
        title,
        price,
        scraped_at,
        property_id,
        properties (
          id,
          address_raw,
          city,
          building_area,
          property_type
        )
      `)
      .gte('scraped_at', oneDayAgo.toISOString())
      .not('property_id', 'is', null);

    if (listingsError) {
      throw new Error(`Failed to fetch new listings: ${listingsError.message}`);
    }

    if (!newListings || newListings.length === 0) {
      results.message = '過去24時間に新着物件がありません。';
      return NextResponse.json(results);
    }

    // 各保存検索×新着リスティングで条件判定
    for (const search of savedSearches) {
      for (const listing of newListings) {
        results.checked++;

        const property = listing.properties as {
          id: string;
          address_raw: string | null;
          city: string | null;
          building_area: number | null;
          property_type: string | null;
        };

        if (!property) continue;

        // エリアフィルタ
        if (search.areas && search.areas.length > 0) {
          const cityMatches = search.areas.some((area: string) => {
            if (!property.city) return false;
            if (area === '札幌市' && property.city.startsWith('札幌市')) return true;
            return property.city === area;
          });
          if (!cityMatches) continue;
        }

        // 物件タイプフィルタ
        if (search.property_types && search.property_types.length > 0) {
          if (!property.property_type || !search.property_types.includes(property.property_type)) {
            continue;
          }
        }

        // NEUTRALシミュレーションを取得
        const { data: simulation } = await supabase
          .from('simulations')
          .select('annual_revenue')
          .eq('listing_id', listing.id)
          .eq('scenario', 'NEUTRAL')
          .single();

        if (!simulation || !simulation.annual_revenue || !listing.price) {
          continue;
        }

        // 倍率判定
        const multiple = search.multiple || 7;
        const threshold = simulation.annual_revenue * multiple;

        if (listing.price >= threshold) {
          continue;
        }

        // 通知済みチェック
        const { data: existingNotification } = await supabase
          .from('notification_logs')
          .select('id')
          .eq('saved_search_id', search.id)
          .eq('listing_id', listing.id)
          .single();

        if (existingNotification) {
          continue;
        }

        // Slack通知
        try {
          const renovationBudget = simulation.annual_revenue * 10 - listing.price;
          const actualMultiple = (listing.price / simulation.annual_revenue).toFixed(1);
          
          const message = {
            text: `新着物件: ${listing.title}`,
            blocks: [
              {
                type: 'header',
                text: {
                  type: 'plain_text',
                  text: '🏠 条件適合物件を発見！',
                  emoji: true,
                },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*<${listing.url}|${listing.title}>*`,
                },
              },
              {
                type: 'section',
                fields: [
                  { type: 'mrkdwn', text: `*販売価格:* ${Math.round(listing.price / 10000).toLocaleString()}万円` },
                  { type: 'mrkdwn', text: `*年間想定収益:* ${Math.round(simulation.annual_revenue / 10000).toLocaleString()}万円` },
                  { type: 'mrkdwn', text: `*倍率:* ${actualMultiple}倍 (基準: ${multiple}倍)` },
                  { type: 'mrkdwn', text: `*リノベ予算:* ${Math.round(renovationBudget / 10000).toLocaleString()}万円` },
                  { type: 'mrkdwn', text: `*所在地:* ${property.address_raw || '不明'}` },
                  { type: 'mrkdwn', text: `*建物面積:* ${property.building_area ? `${property.building_area}㎡` : '不明'}` },
                ],
              },
            ],
          };

          const response = await fetch(slackConfig.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
          });

          if (response.ok) {
            // 通知ログ記録
            await supabase
              .from('notification_logs')
              .insert({
                saved_search_id: search.id,
                listing_id: listing.id,
              });

            results.notified++;
          }
        } catch (error) {
          results.errors.push(`通知送信エラー: ${error}`);
        }
      }
    }

    results.message = results.notified > 0 
      ? `${results.notified}件の通知を送信しました`
      : '条件に合致する新着物件はありませんでした';
    
    return NextResponse.json(results);
  } catch (error) {
    console.error('Notify job failed:', error);
    return NextResponse.json(
      { error: String(error), ...results },
      { status: 500 }
    );
  }
}
