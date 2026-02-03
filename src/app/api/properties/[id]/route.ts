import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServer();

  try {
    // リスティング詳細を取得
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select(`
        id,
        url,
        title,
        price,
        scraped_at,
        raw,
        portal_sites (
          name,
          key,
          base_url
        ),
        properties (
          id,
          address_raw,
          normalized_address,
          city,
          building_area,
          land_area,
          built_year,
          rooms,
          property_type,
          lat,
          lng
        )
      `)
      .eq('id', id)
      .single();

    if (listingError) {
      throw listingError;
    }

    // シミュレーション結果を取得
    const { data: simulations, error: simError } = await supabase
      .from('simulations')
      .select(`
        id,
        scenario,
        annual_revenue,
        annual_profit,
        assumptions,
        simulation_monthlies (
          month,
          nightly_rate,
          occupancy_rate,
          booked_nights,
          reservations,
          avg_stay,
          revenue
        )
      `)
      .eq('listing_id', id)
      .order('scenario');

    if (simError) {
      console.error('Failed to fetch simulations:', simError);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const property = listing.properties as any;

    const price = listing.price || 0;
    const neutralSim = simulations?.find(s => s.scenario === 'NEUTRAL');
    const annualRevenue = neutralSim?.annual_revenue || 0;
    const annualProfit = neutralSim?.annual_profit || Math.round(annualRevenue * 0.4);
    const renovationBudget = annualProfit * 10 - price;

    return NextResponse.json({
      id: listing.id,
      url: listing.url,
      title: listing.title,
      price,
      priceMan: Math.round(price / 10000),
      scraped_at: listing.scraped_at,
      portal_site: listing.portal_sites,
      property: {
        id: property.id,
        address: property.address_raw || property.normalized_address || '',
        city: property.city,
        building_area: property.building_area,
        land_area: property.land_area,
        built_year: property.built_year,
        rooms: property.rooms,
        property_type: property.property_type,
        nearest_station: property?.nearest_station ?? null,
        walk_minutes: property?.walk_minutes ?? null,
        lat: property.lat,
        lng: property.lng,
      },
      simulations: simulations?.map(sim => ({
        id: sim.id,
        scenario: sim.scenario,
        annual_revenue: sim.annual_revenue,
        annual_revenue_man: Math.round((sim.annual_revenue || 0) / 10000),
        annual_profit: sim.annual_profit,
        annual_profit_man: Math.round((sim.annual_profit || 0) / 10000),
        assumptions: sim.assumptions,
        monthlies: (sim.simulation_monthlies as {
          month: number;
          nightly_rate: number | null;
          occupancy_rate: number | null;
          booked_nights: number | null;
          reservations: number | null;
          avg_stay: number | null;
          revenue: number | null;
        }[])?.sort((a, b) => a.month - b.month),
      })) || [],
      annual_revenue: annualRevenue,
      annual_revenue_man: Math.round(annualRevenue / 10000),
      annual_profit: annualProfit,
      annual_profit_man: Math.round(annualProfit / 10000),
      renovation_budget: renovationBudget,
      renovation_budget_man: Math.round(renovationBudget / 10000),
      actual_multiple: annualProfit > 0 ? (price / annualProfit).toFixed(2) : null,
    });
  } catch (error) {
    console.error('Failed to fetch property:', error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
