/**
 * 通知ジョブ
 * 保存検索条件に合致する新着物件をSlack通知
 */
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase';
import { sendSlackMessage, buildPropertyNotification } from './_shared/slack';
import { logInfo, logError } from './_shared/log';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  logInfo('jobs-notify started');
  
  const supabase = getSupabaseAdmin();
  const results = {
    checked: 0,
    notified: 0,
    errors: [] as string[],
  };

  try {
    // 1. Slack設定を取得
    const { data: slackConfig, error: slackError } = await supabase
      .from('slack_configs')
      .select('*')
      .eq('enabled', true)
      .limit(1)
      .single();

    if (slackError || !slackConfig?.webhook_url) {
      logInfo('No enabled Slack config found');
      return { statusCode: 200, body: JSON.stringify({ message: 'Slack not configured' }) };
    }

    // 環境変数のwebhookがあればそちらを優先
    const webhookUrl = process.env.SLACK_WEBHOOK_URL || slackConfig.webhook_url;

    // 2. 有効な保存検索を取得
    const { data: savedSearches, error: searchError } = await supabase
      .from('saved_searches')
      .select('*')
      .eq('enabled', true);

    if (searchError || !savedSearches || savedSearches.length === 0) {
      logInfo('No enabled saved searches');
      return { statusCode: 200, body: JSON.stringify({ message: 'No saved searches' }) };
    }

    // 3. 新着リスティングを取得（過去24時間）
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
      logInfo('No new listings in the last 24 hours');
      return { statusCode: 200, body: JSON.stringify({ message: 'No new listings' }) };
    }

    // 4. 各保存検索×新着リスティングで条件判定
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
          if (!property.city || !search.areas.includes(property.city)) {
            continue;
          }
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

        // 倍率判定: price < annual_revenue * multiple
        const multiple = search.multiple || 7;
        const threshold = simulation.annual_revenue * multiple;

        if (listing.price >= threshold) {
          continue; // 条件不適合
        }

        // 通知済みチェック
        const { data: existingNotification } = await supabase
          .from('notification_logs')
          .select('id')
          .eq('saved_search_id', search.id)
          .eq('listing_id', listing.id)
          .single();

        if (existingNotification) {
          continue; // 既に通知済み
        }

        // Slack通知
        try {
          const renovationBudget = simulation.annual_revenue * 10 - listing.price;
          
          const message = buildPropertyNotification({
            title: listing.title || '物件名不明',
            url: listing.url,
            price: listing.price,
            annualRevenue: simulation.annual_revenue,
            multiple,
            address: property.address_raw || '住所不明',
            buildingArea: property.building_area,
            renovationBudget,
          });

          const sent = await sendSlackMessage(webhookUrl, message);

          if (sent) {
            // 通知ログ記録
            await supabase
              .from('notification_logs')
              .insert({
                saved_search_id: search.id,
                listing_id: listing.id,
              });

            results.notified++;
            logInfo('Notification sent', { listingId: listing.id, searchId: search.id });
          }
        } catch (error) {
          const msg = `Error sending notification for listing ${listing.id}: ${error}`;
          logError(msg);
          results.errors.push(msg);
        }
      }
    }

    logInfo('jobs-notify completed', results);

    return {
      statusCode: 200,
      body: JSON.stringify(results),
    };
  } catch (error) {
    logError('jobs-notify failed', { error: String(error) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};

// Netlify Scheduled Function設定
// [functions."jobs-notify"]
//   schedule = "0 * * * *"  # 1時間ごと
