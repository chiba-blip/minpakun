/**
 * 健美家（Kenbiya）Connector
 * https://www.kenbiya.com/
 * 
 * 注意: スクレイピングは利用規約を確認の上、低頻度で実行すること
 */
import type { 
  Connector, 
  SearchParams, 
  ListingCandidate, 
  ListingDetail, 
  NormalizedListing 
} from './types.mts';
import { fetchHtml, throttle } from '../http.mts';
import { logInfo, logError } from '../log.mts';
import { normalizeAddress, extractCity } from '../normalize/address.mts';

// エリアコードマッピング（北海道）
const AREA_CODES: Record<string, string> = {
  '札幌市': '01100',
  '小樽市': '01203',
  '余市町': '01408',
  'ニセコ町': '01395',
  '倶知安町': '01400',
};

// 物件タイプマッピング
const PROPERTY_TYPE_CODES: Record<string, string> = {
  '中古戸建て': 'house',
  '一棟集合住宅': 'apartment',
};

export class KenbiyaConnector implements Connector {
  readonly key = 'kenbiya';
  readonly name = '健美家';

  private baseUrl = 'https://www.kenbiya.com';

  /**
   * 検索URLを構築
   */
  private buildSearchUrl(params: SearchParams, page: number = 1): string {
    // 健美家の検索URL構造（実際のサイト構造に合わせて調整が必要）
    const areaParams = params.areas
      .map(a => AREA_CODES[a])
      .filter(Boolean)
      .join(',');
    
    const typeParam = params.propertyTypes
      .map(t => PROPERTY_TYPE_CODES[t])
      .filter(Boolean)[0] || 'house';

    // 北海道の中古戸建て/一棟を検索
    return `${this.baseUrl}/list/?pref=01&area=${areaParams}&type=${typeParam}&page=${page}`;
  }

  /**
   * 検索を実行し、候補リストを取得
   */
  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 5;

    logInfo(`[${this.key}] Starting search`, { areas: params.areas, types: params.propertyTypes });

    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = this.buildSearchUrl(params, page);
        logInfo(`[${this.key}] Fetching page ${page}`, { url });

        const html = await fetchHtml(url);
        const pageResults = this.parseSearchResults(html);

        if (pageResults.length === 0) {
          logInfo(`[${this.key}] No more results at page ${page}`);
          break;
        }

        candidates.push(...pageResults);
        await throttle(2000); // 2秒待機
      } catch (error) {
        logError(`[${this.key}] Search error at page ${page}`, { error: String(error) });
        break;
      }
    }

    logInfo(`[${this.key}] Search complete`, { count: candidates.length });
    return candidates;
  }

  /**
   * 検索結果HTMLをパース
   */
  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];

    // 簡易的な正規表現パース（Cheerioを使う場合は置き換え）
    // 実際のHTML構造に合わせて調整が必要
    const propertyPattern = /<a[^>]*href="(\/[^"]*detail[^"]*)"[^>]*>[\s\S]*?<\/a>/gi;
    const matches = html.matchAll(propertyPattern);

    for (const match of matches) {
      const relativeUrl = match[1];
      if (relativeUrl && !results.some(r => r.url.includes(relativeUrl))) {
        results.push({
          url: `${this.baseUrl}${relativeUrl}`,
        });
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
    
    // HTMLから各種情報を抽出（実際のHTML構造に合わせて調整）
    const detail: ListingDetail = {
      url,
      title: this.extractTitle(html),
      price: this.extractPrice(html),
      address_raw: this.extractAddress(html),
      building_area: this.extractNumber(html, /建物面積[：:]\s*([\d.]+)\s*[㎡m]/),
      land_area: this.extractNumber(html, /土地面積[：:]\s*([\d.]+)\s*[㎡m]/),
      built_year: this.extractBuiltYear(html),
      rooms: this.extractRooms(html),
      property_type: this.extractPropertyType(html),
      external_id: this.extractExternalId(url),
      raw: { html: html.substring(0, 50000) }, // 最初の50KB保存
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
    const match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    return match ? match[1].trim() : '物件名不明';
  }

  private extractPrice(html: string): number | null {
    const match = html.match(/価格[：:]\s*([\d,]+)\s*万円/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10) * 10000;
    }
    return null;
  }

  private extractAddress(html: string): string | null {
    const match = html.match(/所在地[：:]\s*([^<\n]+)/);
    return match ? match[1].trim() : null;
  }

  private extractNumber(html: string, pattern: RegExp): number | null {
    const match = html.match(pattern);
    return match ? parseFloat(match[1]) : null;
  }

  private extractBuiltYear(html: string): number | null {
    const match = html.match(/築年[月日]?[：:]\s*(\d{4})年/);
    return match ? parseInt(match[1], 10) : null;
  }

  private extractRooms(html: string): number | null {
    // 戸建ては1、一棟の場合は戸数を抽出
    const match = html.match(/総戸数[：:]\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  }

  private extractPropertyType(html: string): string | null {
    if (html.includes('一棟') || html.includes('アパート') || html.includes('マンション')) {
      return '一棟集合住宅';
    }
    if (html.includes('戸建て') || html.includes('戸建') || html.includes('一軒家')) {
      return '中古戸建て';
    }
    return null;
  }

  private extractExternalId(url: string): string | null {
    const match = url.match(/\/(\d+)\/?$/);
    return match ? match[1] : null;
  }
}
