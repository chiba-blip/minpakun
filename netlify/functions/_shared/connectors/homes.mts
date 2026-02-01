/**
 * LIFULL HOME'S Connector
 * https://www.homes.co.jp/
 * 
 * URL構造:
 * - 北海道中古一戸建て: /kodate/b-1010101/
 * - 北海道中古マンション: /mansion/b-1010101/
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

// 北海道のエリアコード
const HOKKAIDO_CODE = '1010101';

// 物件タイプのURL部分
const PROPERTY_TYPE_PATHS: Record<string, string> = {
  '一戸建て': 'kodate',
  'マンション': 'mansion',
  '別荘': 'kodate',
};

export class HomesConnector implements Connector {
  readonly key = 'homes';
  readonly name = 'LIFULL HOME\'S';

  private baseUrl = 'https://www.homes.co.jp';

  /**
   * 検索URLを構築
   */
  private buildSearchUrl(propertyType: string, page: number = 1): string {
    const typePath = PROPERTY_TYPE_PATHS[propertyType] || 'kodate';
    
    let url = `${this.baseUrl}/${typePath}/b-${HOKKAIDO_CODE}/`;
    
    if (page > 1) {
      url += `list/?page=${page}`;
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

    const propertyTypes = params.propertyTypes.length > 0 
      ? params.propertyTypes 
      : ['一戸建て'];

    for (const propType of propertyTypes) {
      for (let page = 1; page <= maxPages; page++) {
        try {
          const url = this.buildSearchUrl(propType, page);
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

    // HOME'S物件詳細リンクのパターン
    const propertyPattern = /href="(https:\/\/www\.homes\.co\.jp\/(?:kodate|mansion)\/b-\d+\/\d+\/?[^"]*)"/gi;
    const matches = html.matchAll(propertyPattern);

    for (const match of matches) {
      let fullUrl = match[1];
      fullUrl = fullUrl.split('?')[0];
      
      if (!results.some(r => r.url === fullUrl)) {
        results.push({ url: fullUrl });
      }
    }

    // 相対URLパターン
    const relativePattern = /href="(\/(?:kodate|mansion)\/b-\d+\/\d+\/?[^"]*)"/gi;
    const relativeMatches = html.matchAll(relativePattern);

    for (const match of relativeMatches) {
      let fullUrl = `${this.baseUrl}${match[1]}`;
      fullUrl = fullUrl.split('?')[0];
      
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

  private extractTitle(html: string): string {
    const patterns = [
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
    if (url.includes('/mansion/') || html.includes('マンション')) {
      return 'マンション';
    }
    if (url.includes('/kodate/') || html.includes('一戸建') || html.includes('戸建')) {
      return '一戸建て';
    }
    return null;
  }

  private extractExternalId(url: string): string | null {
    const match = url.match(/\/(\d{8,})\/?$/);
    return match ? match[1] : null;
  }
}
