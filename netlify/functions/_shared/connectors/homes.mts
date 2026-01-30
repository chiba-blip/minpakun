/**
 * LIFULL HOME'S Connector
 * https://www.homes.co.jp/
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

export class HomesConnector implements Connector {
  readonly key = 'homes';
  readonly name = 'LIFULL HOME\'S';

  private baseUrl = 'https://www.homes.co.jp';

  private buildSearchUrl(params: SearchParams, page: number = 1): string {
    // HOME'Sの北海道中古一戸建て検索URL
    return `${this.baseUrl}/kodate/chuko/hokkaido/list/?page=${page}`;
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
        await throttle(3000);
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
    
    // HOME'Sの物件リンクパターン
    const propertyPattern = /href="(\/kodate\/[^"]*\/[a-z0-9]+\/)"/gi;
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
      building_area: this.extractNumber(html, /建物面積[：:\s]*([\d.]+)\s*[㎡m]/),
      land_area: this.extractNumber(html, /土地面積[：:\s]*([\d.]+)\s*[㎡m]/),
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
    const match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    return match ? match[1].trim() : '物件名不明';
  }

  private extractPrice(html: string): number | null {
    const match = html.match(/([\d,]+)\s*万円/);
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
    const match = html.match(/(\d{4})年[^<]*築/);
    return match ? parseInt(match[1], 10) : null;
  }

  private extractExternalId(url: string): string | null {
    const match = url.match(/\/([a-z0-9]+)\/$/i);
    return match ? match[1] : null;
  }
}
