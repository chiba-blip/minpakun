import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { geocodeAddress, findNearestStation } from '@/lib/geo';
import { callRentalizer, getMockRentalizerResponse } from '@/lib/airdna';
import { calculateRanges } from '@/lib/calculator';
import { EstimateRequest } from '@/types/property';

// 開発時はモックを使用（AirDNA契約後はfalseに）
const USE_MOCK_AIRDNA = true;

export async function POST(request: NextRequest) {
  try {
    const body: EstimateRequest = await request.json();
    const supabase = createServerClient();

    // 1. 物件情報の検証
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('*')
      .eq('id', body.propertyId)
      .single();

    if (propertyError || !property) {
      return NextResponse.json(
        { success: false, error: '物件が見つかりません' },
        { status: 404 }
      );
    }

    // 2. 既存の見積もり確認（10分以内なら再利用）
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: existingEstimate } = await supabase
      .from('estimates')
      .select('*')
      .eq('property_id', body.propertyId)
      .eq('status', 'ok')
      .gte('created_at', tenMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingEstimate) {
      return NextResponse.json({
        success: true,
        estimateId: existingEstimate.id,
        cached: true,
      });
    }

    // 3. 新しい見積もりレコードを作成
    const { data: estimate, error: createError } = await supabase
      .from('estimates')
      .insert({
        property_id: body.propertyId,
        status: 'processing',
      })
      .select()
      .single();

    if (createError || !estimate) {
      console.error('Failed to create estimate:', createError);
      return NextResponse.json(
        { success: false, error: '見積もり作成に失敗しました' },
        { status: 500 }
      );
    }

    const estimateId = estimate.id;

    try {
      // Step 1: Geocoding（住所→lat/lng）
      let lat = property.lat;
      let lng = property.lng;
      let geocodeResult = null;

      if (!lat || !lng) {
        geocodeResult = await geocodeAddress(body.address);
        
        if (geocodeResult) {
          lat = geocodeResult.lat;
          lng = geocodeResult.lng;

          // 物件情報を更新
          await supabase
            .from('properties')
            .update({ lat, lng })
            .eq('id', body.propertyId);
        } else {
          throw new Error('住所の緯度経度を取得できませんでした。住所を確認してください。');
        }
      }

      // Step 2: 最寄駅検索（Overpass）
      let nearestStation = null;
      try {
        nearestStation = await findNearestStation(lat, lng);
      } catch (error) {
        console.warn('最寄駅検索に失敗しました（続行）:', error);
        // 駅検索失敗は致命的ではない
      }

      // Step 3: AirDNA Rentalizer
      const bedrooms = body.bedrooms ?? 1;
      const bathrooms = body.bathrooms ?? 1;
      
      let airdnaResponse;
      const airdnaRequest = {
        lat,
        lng,
        bedrooms,
        bathrooms,
        accommodates: body.capacity,
      };

      if (USE_MOCK_AIRDNA) {
        // 開発時はモックデータを使用
        airdnaResponse = getMockRentalizerResponse(bedrooms);
      } else {
        airdnaResponse = await callRentalizer(airdnaRequest);
      }

      // Step 4: ネット売上・粗利計算
      const computed = calculateRanges(airdnaResponse.monthly, body.cost);

      // 結果を保存
      await supabase
        .from('estimates')
        .update({
          geocode_result: geocodeResult,
          nearest_station: nearestStation,
          airdna_request: airdnaRequest,
          airdna_response: airdnaResponse,
          computed,
          status: 'ok',
        })
        .eq('id', estimateId);

      return NextResponse.json({
        success: true,
        estimateId,
      });

    } catch (error) {
      // エラー発生時は見積もりをエラー状態に更新
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      
      await supabase
        .from('estimates')
        .update({
          status: 'error',
          error_message: errorMessage,
        })
        .eq('id', estimateId);

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Estimate API error:', error);
    return NextResponse.json(
      { success: false, error: 'リクエストの処理に失敗しました' },
      { status: 500 }
    );
  }
}

