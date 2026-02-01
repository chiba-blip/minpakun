/**
 * 楽待（Rakumachi）Connector
 * https://www.rakumachi.jp/
 * 
 * URL構造:
 * - 収益物件一覧: /syuuekibukken/area/prefecture/dimAll/
 * - 北海道(dim=1): /?pref=1
 * - 物件タイプ: dim[]=1001(区分マンション), dim[]=1002(一棟アパート), dim[]=1003(一棟マンション), dim[]=1004(戸建賃貸)
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

// 北海道の都道府県コード
const HOKKAIDO_PREF_ID = '1';

// 物件タイプコード（楽待のdimパラメータ）
const PROPERTY_TYPE_DIMS: Record<string, string> = {
  '一戸建て': '1004',     // 戸建賃貸
  'マンション': '1001',   // 区分マンション
  'アパート': '1002',      // 一棟アパート
  '一棟マンション': '1003', // 一棟マンション
  '別荘': '1004',         // 戸建として扱う
};

export class RakumachiConnector implements Connector {
  readonly key = 'rakumachi';
  readonly name = '楽待';

  private baseUrl = 'https://www.rakumachi.jp';

  /**
   * 検索URLを構築
   */
  private buildSearchUrl(params: SearchParams, page: number = 1): string {
    const searchParams = new URLSearchParams();
    
    // 北海道を指定
    searchParams.set('pref', HOKKAIDO_PREF_ID);
    
    // 物件タイプを指定
    const dims = params.propertyTypes
      .map(t => PROPERTY_TYPE_DIMS[t])
      .filter(Boolean);
    
    if (dims.length > 0) {
      dims.forEach(dim => {
        searchParams.append('dim[]', dim);
      });
    }
    
    // ページ指定
    if (page > 1) {
      searchParams.set('page', String(page));
    }
    
    // 価格上限（5000万円）
    if (params.maxPrice) {
      searchParams.set('price_to', String(Math.floor(params.maxPrice / 10000)));
    }
    
    // 新着順
    searchParams.set('sort', 'property_created_at');
    searchParams.set('sort_type', 'desc');
    
    return `${this.baseUrl}/syuuekibukken/area/prefecture/dimAll/?${searchParams.toString()}`;
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

    // 楽待の物件詳細リンクパターン
    // /syuuekibukken/hokkaido/dim1004/xxxxxxx/show.html 形式
    const propertyPattern = /href="(\/syuuekibukken\/[^"]*\/\d+\/show\.html)"/gi;
    const matches = html.matchAll(propertyPattern);

    for (const match of matches) {
      const relativeUrl = match[1];
      const fullUrl = `${this.baseUrl}${relativeUrl}`;
      
      if (!results.some(r => r.url === fullUrl)) {
        results.push({ url: fullUrl });
      }
    }

    // 別パターン: /syuuekibukken/.../detail/xxxxx 形式
    const altPattern = /href="(\/syuuekibukken\/[^"]*detail[^"]*)"/gi;
    const altMatches = html.matchAll(altPattern);

    for (const match of altMatches) {
      const relativeUrl = match[1];
      const fullUrl = `${this.baseUrl}${relativeUrl}`;
      
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
      property_type: this.extractPropertyType(html),
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
      /<h1[^>]*class="[^"]*property-title[^"]*"[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title>([^<|]+)/i,
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
      /価格[：:\s]*([\d,]+)\s*万円/,
      /販売価格[：:\s]*([\d,]+)\s*万円/,
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
    
    // 億円パターン
    const okuMatch = html.match(/(\d+)億(\d*)万?円/);
    if (okuMatch) {
      const oku = parseInt(okuMatch[1], 10) * 100000000;
      const man = okuMatch[2] ? parseInt(okuMatch[2], 10) * 10000 : 0;
      return oku + man;
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
      /築年[月]?[：:\s]*(\d{4})年/,
      /(\d{4})年[^\d]*築/,
      /築(\d+)年/,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const year = parseInt(match[1], 10);
        if (year < 100) {
          return new Date().getFullYear() - year;
        }
        return year;
      }
    }
    return null;
  }

  private extractRooms(html: string): number | null {
    const patterns = [
      /総戸数[：:\s]*(\d+)/,
      /(\d+)\s*戸/,
      /(\d+)\s*室/,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return 1;
  }

  private extractPropertyType(html: string): string | null {
    if (html.includes('一棟') || html.includes('アパート')) {
      return 'アパート';
    }
    if (html.includes('戸建') || html.includes('一軒家')) {
      return '一戸建て';
    }
    if (html.includes('マンション')) {
      return 'マンション';
    }
    return null;
  }

  private extractExternalId(url: string): string | null {
    const match = url.match(/\/(\d+)\/show\.html/);
    return match ? match[1] : null;
  }
}
