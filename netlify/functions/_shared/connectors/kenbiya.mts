/**
 * 健美家（Kenbiya）Connector
 * https://www.kenbiya.com/
 * 
 * URL構造:
 * - 北海道全体: /pp0/h/hokkaido/
 * - 札幌市: /pp0/h/hokkaido/sapporo-shi/
 * - 物件タイプ: pp0=全て, pp1=投資用マンション, pp2=一棟アパート, pp3=一棟マンション, pp8=戸建賃貸
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

// 市区町村のURLパス
const CITY_PATHS: Record<string, string> = {
  '札幌市': 'sapporo-shi',
  '札幌市中央区': 'sapporo-shi/chuo-ku',
  '札幌市北区': 'sapporo-shi/kita-ku',
  '札幌市東区': 'sapporo-shi/higashi-ku',
  '札幌市白石区': 'sapporo-shi/shiroishi-ku',
  '札幌市豊平区': 'sapporo-shi/toyohira-ku',
  '札幌市南区': 'sapporo-shi/minami-ku',
  '札幌市西区': 'sapporo-shi/nishi-ku',
  '札幌市厚別区': 'sapporo-shi/atsubetsu-ku',
  '札幌市手稲区': 'sapporo-shi/teine-ku',
  '札幌市清田区': 'sapporo-shi/kiyota-ku',
  '小樽市': 'otaru-shi',
  'ニセコ町': 'abuta-gun/niseko-cho',
  '倶知安町': 'abuta-gun/kutchan-cho',
  '余市町': 'yoichi-gun/yoichi-cho',
  '富良野市': 'furano-shi',
};

// 物件タイプコード
const PROPERTY_TYPE_CODES: Record<string, string> = {
  '一戸建て': 'pp8',      // 戸建賃貸
  'マンション': 'pp1',    // 投資用マンション
  'アパート': 'pp2',       // 一棟売りアパート
  '一棟マンション': 'pp3', // 一棟売りマンション
  '別荘': 'pp8',          // 戸建として扱う
};

export class KenbiyaConnector implements Connector {
  readonly key = 'kenbiya';
  readonly name = '健美家';

  private baseUrl = 'https://www.kenbiya.com';

  /**
   * 検索URLを構築
   */
  private buildSearchUrls(params: SearchParams): string[] {
    const urls: string[] = [];
    
    // 物件タイプコードを取得（デフォルトは全タイプ pp0）
    const typeCodes = params.propertyTypes
      .map(t => PROPERTY_TYPE_CODES[t])
      .filter(Boolean);
    
    const typeCode = typeCodes.length > 0 ? typeCodes[0] : 'pp0';
    
    // 各エリアのURLを生成
    if (params.areas.length === 0) {
      // エリア指定なしの場合は北海道全体
      urls.push(`${this.baseUrl}/${typeCode}/h/hokkaido/`);
    } else {
      for (const area of params.areas) {
        const cityPath = CITY_PATHS[area];
        if (cityPath) {
          urls.push(`${this.baseUrl}/${typeCode}/h/hokkaido/${cityPath}/`);
        } else if (area.includes('札幌')) {
          // 札幌市全体
          urls.push(`${this.baseUrl}/${typeCode}/h/hokkaido/sapporo-shi/`);
        }
      }
    }
    
    // URLが空の場合は北海道全体
    if (urls.length === 0) {
      urls.push(`${this.baseUrl}/${typeCode}/h/hokkaido/`);
    }
    
    return urls;
  }

  /**
   * 検索を実行し、候補リストを取得
   */
  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 3;
    const searchUrls = this.buildSearchUrls(params);

    logInfo(`[${this.key}] Starting search`, { 
      areas: params.areas, 
      types: params.propertyTypes,
      urls: searchUrls 
    });

    for (const baseSearchUrl of searchUrls) {
      for (let page = 1; page <= maxPages; page++) {
        try {
          const url = page === 1 ? baseSearchUrl : `${baseSearchUrl}?page=${page}`;
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

    // 健美家の物件リンクパターン（詳細ページ）
    // /property/xxxxxxxxx/ 形式
    const propertyPattern = /href="(\/property\/\d+\/?[^"]*)"/gi;
    const matches = html.matchAll(propertyPattern);

    for (const match of matches) {
      const relativeUrl = match[1];
      const fullUrl = `${this.baseUrl}${relativeUrl}`;
      
      if (!results.some(r => r.url === fullUrl)) {
        results.push({ url: fullUrl });
      }
    }

    // 別パターン: /pp[0-9]/h/hokkaido/.../xxxxx/ 形式の詳細リンク
    const altPattern = /href="(\/pp\d\/h\/hokkaido\/[^"]+\/\d+\/?[^"]*)"/gi;
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
    // 複数のパターンを試す
    const patterns = [
      /<h1[^>]*class="[^"]*property[^"]*"[^>]*>([^<]+)<\/h1>/i,
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
    // 「1,980万円」「19800万円」「1億9800万円」など
    const patterns = [
      /価格[：:\s]*([\d,]+)\s*万円/,
      /販売価格[：:\s]*([\d,]+)\s*万円/,
      /([\d,]+)\s*万円/,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const price = parseInt(match[1].replace(/,/g, ''), 10) * 10000;
        if (price > 0 && price < 10000000000) { // 100億円未満
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
        // 築年数の場合は現在年から引く
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
    return 1; // デフォルト1戸
  }

  private extractPropertyType(html: string): string | null {
    if (html.includes('一棟') || html.includes('アパート') || html.includes('収益マンション')) {
      return 'アパート';
    }
    if (html.includes('戸建') || html.includes('一軒家') || html.includes('中古住宅')) {
      return '一戸建て';
    }
    if (html.includes('マンション')) {
      return 'マンション';
    }
    return null;
  }

  private extractExternalId(url: string): string | null {
    const match = url.match(/\/(\d+)\/?(?:\?|$)/);
    return match ? match[1] : null;
  }
}
