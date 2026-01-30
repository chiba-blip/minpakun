import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const scenario = searchParams.get('scenario'); // NEGATIVE, NEUTRAL, POSITIVE, or null for all
  
  const supabase = await createSupabaseServer();

  try {
    // リスティング情報を取得
    const { data: listing } = await supabase
      .from('listings')
      .select(`
        title,
        price,
        properties (
          address_raw,
          building_area
        )
      `)
      .eq('id', id)
      .single();

    // シミュレーション結果を取得
    let query = supabase
      .from('simulations')
      .select(`
        scenario,
        annual_revenue,
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
      .eq('listing_id', id);

    if (scenario) {
      query = query.eq('scenario', scenario);
    }

    const { data: simulations, error } = await query;

    if (error) {
      throw error;
    }

    // CSV生成
    const headers = [
      '月',
      'シナリオ',
      '宿泊単価(円)',
      '稼働率(%)',
      '稼働日数',
      '予約件数',
      '平均宿泊日数',
      '売上(円)',
    ];

    const rows: string[][] = [];

    simulations?.forEach(sim => {
      const monthlies = sim.simulation_monthlies as {
        month: number;
        nightly_rate: number | null;
        occupancy_rate: number | null;
        booked_nights: number | null;
        reservations: number | null;
        avg_stay: number | null;
        revenue: number | null;
      }[];

      monthlies?.sort((a, b) => a.month - b.month).forEach(m => {
        rows.push([
          String(m.month),
          sim.scenario,
          String(m.nightly_rate || 0),
          String(m.occupancy_rate || 0),
          String(m.booked_nights || 0),
          String(m.reservations || 0),
          String(m.avg_stay || 0),
          String(m.revenue || 0),
        ]);
      });

      // 年間合計行
      const totalRevenue = monthlies?.reduce((sum, m) => sum + (m.revenue || 0), 0) || 0;
      rows.push([
        '合計',
        sim.scenario,
        '-',
        '-',
        String(monthlies?.reduce((sum, m) => sum + (m.booked_nights || 0), 0) || 0),
        String(monthlies?.reduce((sum, m) => sum + (m.reservations || 0), 0) || 0),
        '-',
        String(totalRevenue),
      ]);
    });

    // BOM付きUTF-8 CSV
    const bom = '\uFEFF';
    const csvContent = bom + [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');

    const property = listing?.properties as { address_raw: string | null } | null;
    const filename = `simulation_${listing?.title || id}_${scenario || 'all'}.csv`;

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (error) {
    console.error('Failed to generate CSV:', error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
