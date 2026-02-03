/**
 * 地理計算ユーティリティ
 */

// 地球の半径（メートル）
const EARTH_RADIUS_M = 6371000;

/**
 * Haversine formula - 2点間の直線距離を計算
 * @param lat1 緯度1
 * @param lng1 経度1
 * @param lat2 緯度2
 * @param lng2 経度2
 * @returns 距離（メートル）
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

/**
 * Google Geocoding APIで住所→緯度経度を取得
 */
export async function geocodeAddress(address: string): Promise<{
  lat: number;
  lng: number;
  formatted_address: string;
} | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is not configured');
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('region', 'jp');
  url.searchParams.set('language', 'ja');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Geocoding API error: ${res.status}`);
  }

  const data = await res.json();

  if (data.status !== 'OK' || !data.results?.length) {
    return null;
  }

  const result = data.results[0];
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formatted_address: result.formatted_address,
  };
}

interface OverpassStation {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: {
    name?: string;
    [key: string]: string | undefined;
  };
}

/**
 * Overpass APIで最寄駅を検索
 * @param lat 物件の緯度
 * @param lng 物件の経度
 * @param radiusM 検索半径（メートル）
 */
export async function findNearestStation(
  lat: number,
  lng: number,
  radiusM: number = 30000,
  options?: {
    /** Overpass fetch timeout (ms) */
    timeoutMs?: number;
    /** 半径を段階的に拡大するか（サーバレスでは遅くなるのでfalse推奨） */
    expandRadii?: boolean;
  }
): Promise<{
  name: string;
  lat: number;
  lng: number;
  distance_m: number;
} | null> {
  // 段階的に半径を拡大（道東・道北対応）
  const radiusSteps = options?.expandRadii === false ? [radiusM] : [radiusM, 50000, 80000];
  const timeoutMs = options?.timeoutMs ?? 6000;

  for (const radius of radiusSteps) {
    const query = `
[out:json][timeout:10];
(
  nwr(around:${radius},${lat},${lng})["railway"="station"];
);
out center;
`.trim();

    const url = 'https://overpass-api.de/api/interpreter';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        console.error(`Overpass API error: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const elements: OverpassStation[] = data.elements || [];

      // 駅名があるものだけフィルタ
      const stations = elements
        .map((el) => {
          const stationLat = el.lat ?? el.center?.lat;
          const stationLng = el.lon ?? el.center?.lon;
          const name = el.tags?.name;

          if (!stationLat || !stationLng || !name) return null;

          return {
            name,
            lat: stationLat,
            lng: stationLng,
            distance_m: haversineDistance(lat, lng, stationLat, stationLng),
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (stations.length > 0) {
        // 最も近い駅を返す
        stations.sort((a, b) => a.distance_m - b.distance_m);
        return stations[0];
      }
    } catch (error) {
      console.error('Overpass API error:', error);
      // タイムアウト等の場合は次の半径を試す
    }
  }

  return null;
}

