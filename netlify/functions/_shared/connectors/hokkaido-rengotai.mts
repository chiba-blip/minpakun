/**
 * 北海道不動産連合隊 Connector
 * https://www.rengotai.com/
 * 
 * 北海道専門の不動産ポータル
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

export class HokkaidoRengotaiConnector implements Connector {
  readonly key = 'hokkaido-rengotai';
  readonly name = '北海道不動産連合隊';

  private baseUrl = 'https://www.rengotai.com';

  /**
   * 検索URLを構築
   */
  private buildSearchUrl(propertyType: string, page: number = 1): string {
    // 連合隊の検索URL構造
    // 中古一戸建て: /sale/kodate/
    // 中古マンション: /sale/mansion/
    let typePath = 'kodate';
    if (propertyType === 'マンション') {
      typePath = 'mansion';
    }
    
    let url = `${this.baseUrl}/sale/${typePath}/`;
    
    if (page > 1) {
      url += `?page=${page}`;
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

    // 連合隊の物件詳細リンクパターン
    const propertyPattern = /href="(https:\/\/www\.rengotai\.com\/[^"]*detail[^"]*)"/gi;
    const matches = html.matchAll(propertyPattern);

    for (const match of matches) {
      let fullUrl = match[1];
      fullUrl = fullUrl.split('?')[0];
      
      if (!results.some(r => r.url === fullUrl)) {
        results.push({ url: fullUrl });
      }
    }

    // 相対URLパターン
    const relativePattern = /href="(\/sale\/[^"]*\/\d+\/?[^"]*)"/gi;
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
    const match = url.match(/\/(\d+)\/?$/);
    return match ? match[1] : null;
  }
}
