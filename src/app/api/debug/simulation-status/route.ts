import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = await createSupabaseServer();

  try {
    // 全リスティング数
    const { count: totalListings } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true });

    // property_idがあるリスティング数
    const { count: withPropertyId } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .not('property_id', 'is', null);

    // シミュレーション済みリスティング数
    const { count: simulated } = await supabase
      .from('simulations')
      .select('listing_id', { count: 'exact', head: true });

    // 住所がある物件数
    const { count: withAddress } = await supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .not('address_raw', 'is', null)
      .neq('address_raw', '');

    // 住所がない物件数
    const { count: withoutAddress } = await supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .or('address_raw.is.null,address_raw.eq.');

    // サンプル：住所がない物件
    const { data: noAddressSamples } = await supabase
      .from('listings')
      .select(`
        id,
        title,
        url,
        property_id,
        properties (
          id,
          address_raw,
          city
        )
      `)
      .not('property_id', 'is', null)
      .limit(10);

    const samplesWithoutAddress = noAddressSamples?.filter(l => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prop = l.properties as any;
      return !prop?.address_raw || prop.address_raw === '';
    });

    // シミュレーション未実行のリスティング（住所あり）
    const { data: existingSims } = await supabase
      .from('simulations')
      .select('listing_id');
    const simmedIds = new Set(existingSims?.map(s => s.listing_id) || []);

    const { data: unsimulatedWithAddress } = await supabase
      .from('listings')
      .select(`
        id,
        title,
        properties (
          address_raw
        )
      `)
      .not('property_id', 'is', null)
      .limit(50);

    const pendingWithAddress = unsimulatedWithAddress?.filter(l => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prop = l.properties as any;
      return !simmedIds.has(l.id) && prop?.address_raw && prop.address_raw !== '';
    }).length || 0;

    return NextResponse.json({
      total_listings: totalListings,
      with_property_id: withPropertyId,
      simulated_count: simulated ? Math.floor(simulated / 3) : 0, // 3シナリオ分
      properties: {
        with_address: withAddress,
        without_address: withoutAddress,
      },
      pending_simulation_with_address: pendingWithAddress,
      samples_without_address: samplesWithoutAddress?.slice(0, 5).map(s => ({
        id: s.id,
        title: s.title,
        url: s.url,
      })),
    });
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
