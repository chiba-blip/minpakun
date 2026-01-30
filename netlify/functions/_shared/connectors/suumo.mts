/**
 * SUUMO Connector
 * https://suumo.jp/
 * 
 * URL構造:
 * - 北海道中古一戸建て: /chukoikkodate/hokkaido/
 * - 北海道中古マンション: /chukomansion/hokkaido/
 * - エリア検索: /chukoikkodate/hokkaido_/city/
 */
import type { 
  Connector, 
  SearchParams, 
  ListingCandidate, 
  ListingDetail, 
  NormalizedListing 
} from './types';
import { fetchHtml, throttle } from '../http';
import { logInfo, logError } from '../log';
import { normalizeAddress, extractCity } from '../normalize/address';

// 物件タイプのURL部分
const PROPERTY_TYPE_PATHS: Record<string, string> = {
  '一戸建て': 'chukoikkodate',     // 中古一戸建て
  'マンション': 'chukomansion',    // 中古マンション
  '別荘': 'chukoikkodate',         // 一戸建てとして扱う
};

// 市区町村コード（SUUMO用）
const CITY_CODES: Record<string, string> = {
  '札幌市': 'sc_01100',
  '札幌市中央区': 'sc_01101',
  '札幌市北区': 'sc_01102',
  '札幌市東区': 'sc_01103',
  '札幌市白石区': 'sc_01104',
  '札幌市豊平区': 'sc_01105',
  '札幌市南区': 'sc_01106',
  '札幌市西区': 'sc_01107',
  '札幌市厚別区': 'sc_01108',
  '札幌市手稲区': 'sc_01109',
  '札幌市清田区': 'sc_01110',
  '小樽市': 'sc_01203',
  'ニセコ町': 'sc_01395',
  '倶知安町': 'sc_01400',
  '富良野市': 'sc_01229',
};

export class SuumoConnector implements Connector {
  readonly key = 'suumo';
  readonly name = 'SUUMO';

  private baseUrl = 'https://suumo.jp';

  /**
   * 検索URLを構築
   */
  private buildSearchUrl(params: SearchParams, page: number = 1): string {
    // 物件タイプを決定
    const propertyType = params.propertyTypes.length > 0 
      ? PROPERTY_TYPE_PATHS[params.propertyTypes[0]] || 'chukoikkodate'
      : 'chukoikkodate';
    
    // 基本URL
    let url = `${this.baseUrl}/${propertyType}/hokkaido/`;
    
    // ページ指定
    if (page > 1) {
      url += `?pn=${page}`;
    }
    
    return url;
  }

  /**
   * 検索を実行し、候補リストを取得
   */
  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 3;

    logInfo(`[${this.key}] Starting search`, { 
      areas: params.areas, 
      types: params.propertyTypes 
    });

    // 物件タイプごとに検索
    const propertyTypes = params.propertyTypes.length > 0 
      ? params.propertyTypes 
      : ['一戸建て'];

    for (const propType of propertyTypes) {
      const typePath = PROPERTY_TYPE_PATHS[propType] || 'chukoikkodate';
      
      for (let page = 1; page <= maxPages; page++) {
        try {
          const url = `${this.baseUrl}/${typePath}/hokkaido/${page > 1 ? `?pn=${page}` : ''}`;
          logInfo(`[${this.key}] Fetching page ${page}`, { url });

          const html = await fetchHtml(url);
          const pageResults = this.parseSearchResults(html);

          if (pageResults.length === 0) {
            logInfo(`[${this.key}] No more results at page ${page}`);
            break;
          }

          candidates.push(...pageResults);
          await throttle(2000);
        } catch (error) {
          logError(`[${this.key}] Search error at page ${page}`, { error: String(error) });
          break;
        }
      }
    }

    // 重複除去
    const uniqueCandidates = candidates.filter((c, i, arr) => 
      arr.findIndex(x => x.url === c.url) === i
    );

    logInfo(`[${this.key}] Search complete`, { count: uniqueCandidates.length });
    return uniqueCandidates;
  }

  /**
   * 検索結果HTMLをパース
   */
  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];

    // SUUMO物件詳細リンクのパターン
    // /chukoikkodate/__JJ_JJ010FJ100_xxxxxxx.html 形式
    const propertyPattern = /href="(https:\/\/suumo\.jp\/chukoikkodate\/[^"]+\.html)"/gi;
    const matches = html.matchAll(propertyPattern);

    for (const match of matches) {
      const fullUrl = match[1];
      if (!results.some(r => r.url === fullUrl)) {
        results.push({ url: fullUrl });
      }
    }

    // 中古マンションパターン
    const mansionPattern = /href="(https:\/\/suumo\.jp\/chukomansion\/[^"]+\.html)"/gi;
    const mansionMatches = html.matchAll(mansionPattern);

    for (const match of mansionMatches) {
      const fullUrl = match[1];
      if (!results.some(r => r.url === fullUrl)) {
        results.push({ url: fullUrl });
      }
    }

    // 相対URLパターン
    const relativePattern = /href="(\/(?:chukoikkodate|chukomansion)\/[^"]+\.html)"/gi;
    const relativeMatches = html.matchAll(relativePattern);

    for (const match of relativeMatches) {
      const fullUrl = `${this.baseUrl}${match[1]}`;
      if (!results.some(r => r.url === fullUrl)) {
        results.push({ url: fullUrl });
      }
    }

    return results;
  }

  /**
   * 詳細ページから情報を取得
   */
  async fetchDetail(url: string): Promise<ListingDetail> {
    logInfo(`[${this.key}] Fetching detail`, { url });
    
    const html = await fetchHtml(url);
    
    const detail: ListingDetail = {
      url,
      title: this.extractTitle(html),
      price: this.extractPrice(html),
      address_raw: this.extractAddress(html),
      building_area: this.extractBuildingArea(html),
      land_area: this.extractLandArea(html),
      built_year: this.extractBuiltYear(html),
      rooms: this.extractRooms(html),
      property_type: this.extractPropertyType(html, url),
      external_id: this.extractExternalId(url),
      raw: { url, scraped_at: new Date().toISOString() },
    };

    await throttle(1500);
    return detail;
  }

  /**
   * 詳細を正規化
   */
  normalize(detail: ListingDetail): NormalizedListing {
    const normalizedAddress = normalizeAddress(detail.address_raw || '');
    const city = extractCity(detail.address_raw || '');

    return {
      url: detail.url,
      title: detail.title,
      price: detail.price,
      external_id: detail.external_id || null,
      raw: detail.raw,
      property: {
        address_raw: detail.address_raw,
        normalized_address: normalizedAddress,
        city,
        building_area: detail.building_area,
        land_area: detail.land_area,
        built_year: detail.built_year,
        rooms: detail.rooms,
        property_type: detail.property_type,
      },
    };
  }

  // ヘルパーメソッド
  private extractTitle(html: string): string {
    const patterns = [
      /<h1[^>]*class="[^"]*bukkenName[^"]*"[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title>([^<|｜]+)/i,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1].trim()) {
        return match[1].trim().replace(/\s+/g, ' ');
      }
    }
    return '物件名不明';
  }

  private extractPrice(html: string): number | null {
    const patterns = [
      /販売価格[：:\s]*([\d,]+)\s*万円/,
      /価格[：:\s]*([\d,]+)\s*万円/,
      /([\d,]+)\s*万円/,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const price = parseInt(match[1].replace(/,/g, ''), 10) * 10000;
        if (price > 0 && price < 10000000000) {
          return price;
        }
      }
    }
    
    return null;
  }

  private extractAddress(html: string): string | null {
    const patterns = [
      /所在地[：:\s]*<[^>]*>([^<]+)</,
      /所在地[：:\s]*([^<\n]+)/,
      /住所[：:\s]*([^<\n]+)/,
      /北海道[^\s<]+[市町村区][^\s<]*/,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return match[1]?.trim() || match[0]?.trim();
      }
    }
    return null;
  }

  private extractBuildingArea(html: string): number | null {
    const patterns = [
      /建物面積[：:\s]*([\d.]+)\s*[㎡m²]/,
      /延床面積[：:\s]*([\d.]+)\s*[㎡m²]/,
      /専有面積[：:\s]*([\d.]+)\s*[㎡m²]/,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return parseFloat(match[1]);
      }
    }
    return null;
  }

  private extractLandArea(html: string): number | null {
    const match = html.match(/土地面積[：:\s]*([\d.]+)\s*[㎡m²]/);
    return match ? parseFloat(match[1]) : null;
  }

  private extractBuiltYear(html: string): number | null {
    const patterns = [
      /築年月[：:\s]*(\d{4})年/,
      /築年[：:\s]*(\d{4})年/,
      /(\d{4})年[^\d]*築/,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return null;
  }

  private extractRooms(html: string): number | null {
    const match = html.match(/(\d+)[SLDK]+/i);
    return match ? parseInt(match[1], 10) : 1;
  }

  private extractPropertyType(html: string, url: string): string | null {
    if (url.includes('chukomansion') || html.includes('マンション')) {
      return 'マンション';
    }
    if (url.includes('chukoikkodate') || html.includes('一戸建') || html.includes('戸建')) {
      return '一戸建て';
    }
    return null;
  }

  private extractExternalId(url: string): string | null {
    const match = url.match(/(\d{10,})\.html/);
    return match ? match[1] : null;
  }
}
