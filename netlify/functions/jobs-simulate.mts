/**
 * シミュレーションジョブ
 * 新規リスティングに対して3シナリオのシミュレーションを実行
 */
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase.mts';
import { runSimulation } from './_shared/simulate/index.mts';
import type { PropertyInput } from './_shared/simulate/types.mts';
import { logInfo, logError } from './_shared/log.mts';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  logInfo('jobs-simulate started');
  
  const supabase = getSupabaseAdmin();
  const results = {
    processed: 0,
    simulated: 0,
    errors: [] as string[],
  };

  try {
    // 1. コスト設定を取得
    const { data: costConfig, error: costError } = await supabase
      .from('cost_configs')
      .select('*')
      .limit(1)
      .single();

    if (costError) {
      logError('Failed to fetch cost_configs', { error: costError.message });
    }

    const costSettings = costConfig ? {
      cleaning_fee_per_reservation: costConfig.cleaning_fee_per_reservation,
      ota_fee_rate: costConfig.ota_fee_rate,
      management_fee_rate: costConfig.management_fee_rate,
      other_cost_rate: costConfig.other_cost_rate,
    } : undefined;

    // 2. シミュレーション未実行のリスティングを取得
    // (simulations テーブルにエントリがないlisting)
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select(`
        id,
        property_id,
        properties (
          id,
          building_area,
          land_area,
          rooms,
          property_type,
          lat,
          lng,
          city
        )
      `)
      .not('property_id', 'is', null)
      .order('scraped_at', { ascending: false })
      .limit(50); // バッチサイズ

    if (listingsError) {
      throw new Error(`Failed to fetch listings: ${listingsError.message}`);
    }

    if (!listings || listings.length === 0) {
      logInfo('No listings to simulate');
      return { statusCode: 200, body: JSON.stringify({ message: 'No listings to process' }) };
    }

    // 3. 各リスティングでシミュレーション実行
    for (const listing of listings) {
      results.processed++;

      // 既存シミュレーションをチェック
      const { data: existingSim } = await supabase
        .from('simulations')
        .select('id')
        .eq('listing_id', listing.id)
        .limit(1);

      if (existingSim && existingSim.length > 0) {
        continue; // 既にシミュレーション済み
      }

      const property = listing.properties as unknown as PropertyInput & { id: string };
      if (!property) continue;

      try {
        const propertyInput: PropertyInput = {
          building_area: property.building_area,
          land_area: property.land_area,
          rooms: property.rooms,
          property_type: property.property_type,
          lat: property.lat,
          lng: property.lng,
          city: property.city,
        };

        // シミュレーション実行
        const simResults = await runSimulation(propertyInput, costSettings);

        // 結果をDB保存
        for (const sim of simResults) {
          const { data: insertedSim, error: simError } = await supabase
            .from('simulations')
            .insert({
              property_id: property.id,
              listing_id: listing.id,
              scenario: sim.scenario,
              annual_revenue: sim.annual_revenue,
              annual_profit: sim.annual_profit,
              assumptions: sim.assumptions,
            })
            .select('id')
            .single();

          if (simError) {
            throw new Error(`Failed to insert simulation: ${simError.message}`);
          }

          // 月次データ保存
          const monthlyInserts = sim.monthlies.map(m => ({
            simulation_id: insertedSim.id,
            month: m.month,
            nightly_rate: m.nightly_rate,
            occupancy_rate: m.occupancy_rate,
            booked_nights: m.booked_nights,
            reservations: m.reservations,
            avg_stay: m.avg_stay,
            revenue: m.revenue,
          }));

          const { error: monthlyError } = await supabase
            .from('simulation_monthlies')
            .insert(monthlyInserts);

          if (monthlyError) {
            logError('Failed to insert monthlies', { error: monthlyError.message });
          }
        }

        results.simulated++;
        logInfo('Simulation completed', { listingId: listing.id });
      } catch (error) {
        const msg = `Error simulating listing ${listing.id}: ${error}`;
        logError(msg);
        results.errors.push(msg);
      }
    }

    logInfo('jobs-simulate completed', results);

    return {
      statusCode: 200,
      body: JSON.stringify(results),
    };
  } catch (error) {
    logError('jobs-simulate failed', { error: String(error) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};

// Netlify Scheduled Function設定
// [functions."jobs-simulate"]
//   schedule = "30 */6 * * *"  # 6時間ごと（scrapeの30分後）
