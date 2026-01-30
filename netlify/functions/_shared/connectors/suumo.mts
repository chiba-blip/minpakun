/**
 * SUUMO Connector
 * https://suumo.jp/
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
const AREA_CODES: Record<string, string> = {
  '札幌市': 'sc_01101',
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
  '余市町': 'sc_01408',
  'ニセコ町': 'sc_01395',
  '倶知安町': 'sc_01400',
};

export class SuumoConnector implements Connector {
  readonly key = 'suumo';
  readonly name = 'SUUMO';

  private baseUrl = 'https://suumo.jp';

  private buildSearchUrl(params: SearchParams, page: number = 1): string {
    // SUUMOの北海道中古一戸建て検索URL
    const areaParams = params.areas
      .map(a => AREA_CODES[a])
      .filter(Boolean)
      .join('&');
    
    // 中古一戸建て
    return `${this.baseUrl}/jj/bukken/ichiran/JJ010FJ001/?ar=010&bs=021&${areaParams}&pn=${page}`;
  }

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 3;

    logInfo(`[${this.key}] Starting search`, { areas: params.areas });

    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = this.buildSearchUrl(params, page);
        logInfo(`[${this.key}] Fetching page ${page}`, { url });

        const html = await fetchHtml(url);
        const pageResults = this.parseSearchResults(html);

        if (pageResults.length === 0) break;

        candidates.push(...pageResults);
        await throttle(3000); // 3秒待機
      } catch (error) {
        logError(`[${this.key}] Search error at page ${page}`, { error: String(error) });
        break;
      }
    }

    logInfo(`[${this.key}] Search complete`, { count: candidates.length });
    return candidates;
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    
    // SUUMOの物件リンクパターン
    const propertyPattern = /href="(\/jj\/bukken\/shosai\/[^"]+)"/gi;
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

  async fetchDetail(url: string): Promise<ListingDetail> {
    logInfo(`[${this.key}] Fetching detail`, { url });
    
    const html = await fetchHtml(url);
    
    const detail: ListingDetail = {
      url,
      title: this.extractTitle(html),
      price: this.extractPrice(html),
      address_raw: this.extractAddress(html),
      building_area: this.extractNumber(html, /建物面積[：:\s]*([\d.]+)\s*m/),
      land_area: this.extractNumber(html, /土地面積[：:\s]*([\d.]+)\s*m/),
      built_year: this.extractBuiltYear(html),
      rooms: 1,
      property_type: '中古戸建て',
      external_id: this.extractExternalId(url),
      raw: { html: html.substring(0, 50000) },
    };

    await throttle(2000);
    return detail;
  }

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
    const match = html.match(/<h1[^>]*class="[^"]*section_h1[^"]*"[^>]*>([^<]+)/i);
    return match ? match[1].trim() : '物件名不明';
  }

  private extractPrice(html: string): number | null {
    const match = html.match(/販売価格[^<]*<[^>]*>([\d,]+)\s*万円/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10) * 10000;
    }
    return null;
  }

  private extractAddress(html: string): string | null {
    const match = html.match(/所在地[^<]*<[^>]*>([^<]+)/);
    return match ? match[1].trim() : null;
  }

  private extractNumber(html: string, pattern: RegExp): number | null {
    const match = html.match(pattern);
    return match ? parseFloat(match[1]) : null;
  }

  private extractBuiltYear(html: string): number | null {
    const match = html.match(/築年月[^<]*<[^>]*>(\d{4})年/);
    return match ? parseInt(match[1], 10) : null;
  }

  private extractExternalId(url: string): string | null {
    const match = url.match(/nc=(\d+)/);
    return match ? match[1] : null;
  }
}
