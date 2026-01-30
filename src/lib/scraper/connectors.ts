/**
 * 全ポータルサイトのコネクター
 * maxPages を 200 に設定して全ページを取得
 */
import type { Connector, SearchParams, ListingCandidate, ListingDetail, NormalizedListing } from './types';
import { fetchHtml, throttle } from './http';
import { normalizeAddress, extractCity } from './normalize';

// =============================================================================
// 健美家（Kenbiya）
// =============================================================================
const KENBIYA_CITY_PATHS: Record<string, string> = {
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
};

const KENBIYA_TYPE_CODES: Record<string, string> = {
  '一戸建て': 'pp8',
  'マンション': 'pp1',
  'アパート': 'pp2',
  '一棟マンション': 'pp3',
  '別荘': 'pp8',
};

export class KenbiyaConnector implements Connector {
  readonly key = 'kenbiya';
  readonly name = '健美家';
  private baseUrl = 'https://www.kenbiya.com';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
    const typeCodes = params.propertyTypes.map(t => KENBIYA_TYPE_CODES[t]).filter(Boolean);
    const typeCode = typeCodes.length > 0 ? typeCodes[0] : 'pp0';
    
    const urls: string[] = [];
    if (params.areas.length === 0) {
      urls.push(`${this.baseUrl}/${typeCode}/h/hokkaido/`);
    } else {
      for (const area of params.areas) {
        const cityPath = KENBIYA_CITY_PATHS[area];
        if (cityPath) {
          urls.push(`${this.baseUrl}/${typeCode}/h/hokkaido/${cityPath}/`);
        } else if (area.includes('札幌')) {
          urls.push(`${this.baseUrl}/${typeCode}/h/hokkaido/sapporo-shi/`);
        }
      }
    }
    if (urls.length === 0) urls.push(`${this.baseUrl}/${typeCode}/h/hokkaido/`);

    for (const baseUrl of urls) {
      for (let page = 1; page <= maxPages; page++) {
        try {
          const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
          console.log(`[kenbiya] Fetching page ${page}: ${url}`);
          const html = await fetchHtml(url);
          const results = this.parseSearchResults(html);
          if (results.length === 0) break;
          candidates.push(...results);
          await throttle(2000);
        } catch (e) {
          console.error(`[kenbiya] Error at page ${page}:`, e);
          break;
        }
      }
    }

    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    const patterns = [
      /href="(\/property\/\d+\/?[^"]*)"/gi,
      /href="(\/pp\d\/h\/hokkaido\/[^"]+\/\d+\/?[^"]*)"/gi,
    ];
    for (const pattern of patterns) {
      for (const match of html.matchAll(pattern)) {
        const fullUrl = `${this.baseUrl}${match[1]}`;
        if (!results.some(r => r.url === fullUrl)) results.push({ url: fullUrl });
      }
    }
    return results;
  }

  async fetchDetail(url: string): Promise<ListingDetail> {
    const html = await fetchHtml(url);
    await throttle(1500);
    return {
      url,
      title: this.extractMatch(html, [/<h1[^>]*>([^<]+)<\/h1>/i, /<title>([^<|]+)/i]) || '物件名不明',
      price: this.extractPrice(html),
      address_raw: this.extractMatch(html, [/所在地[：:\s]*([^<\n]+)/, /北海道[^\s<]+[市町村区][^\s<]*/]),
      building_area: this.extractNumber(html, /建物面積[：:\s]*([\d.]+)/),
      land_area: this.extractNumber(html, /土地面積[：:\s]*([\d.]+)/),
      built_year: this.extractBuiltYear(html),
      rooms: this.extractNumber(html, /総戸数[：:\s]*(\d+)/) || 1,
      property_type: this.detectPropertyType(html),
      external_id: url.match(/\/(\d+)\/?$/)?.[1] || null,
      raw: { url, scraped_at: new Date().toISOString() },
    };
  }

  normalize(detail: ListingDetail): NormalizedListing {
    return {
      url: detail.url,
      title: detail.title,
      price: detail.price,
      external_id: detail.external_id || null,
      raw: detail.raw,
      property: {
        address_raw: detail.address_raw,
        normalized_address: normalizeAddress(detail.address_raw || ''),
        city: extractCity(detail.address_raw || ''),
        building_area: detail.building_area,
        land_area: detail.land_area,
        built_year: detail.built_year,
        rooms: detail.rooms,
        property_type: detail.property_type,
      },
    };
  }

  private extractMatch(html: string, patterns: RegExp[]): string | null {
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return (m[1] || m[0]).trim();
    }
    return null;
  }

  private extractPrice(html: string): number | null {
    const m = html.match(/([\d,]+)\s*万円/);
    if (m) {
      const price = parseInt(m[1].replace(/,/g, ''), 10) * 10000;
      if (price > 0 && price < 10000000000) return price;
    }
    return null;
  }

  private extractNumber(html: string, pattern: RegExp): number | null {
    const m = html.match(pattern);
    return m ? parseFloat(m[1]) : null;
  }

  private extractBuiltYear(html: string): number | null {
    const m = html.match(/築年[月]?[：:\s]*(\d{4})年/) || html.match(/(\d{4})年[^\d]*築/);
    return m ? parseInt(m[1], 10) : null;
  }

  private detectPropertyType(html: string): string | null {
    if (html.includes('一棟') || html.includes('アパート')) return 'アパート';
    if (html.includes('戸建') || html.includes('一軒家')) return '一戸建て';
    if (html.includes('マンション')) return 'マンション';
    return null;
  }
}

// =============================================================================
// 楽待（Rakumachi）
// =============================================================================
const RAKUMACHI_DIMS: Record<string, string> = {
  '一戸建て': '1004',
  'マンション': '1001',
  'アパート': '1002',
  '一棟マンション': '1003',
  '別荘': '1004',
};

export class RakumachiConnector implements Connector {
  readonly key = 'rakumachi';
  readonly name = '楽待';
  private baseUrl = 'https://www.rakumachi.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    const dims = params.propertyTypes.map(t => RAKUMACHI_DIMS[t]).filter(Boolean);
    if (dims.length === 0) dims.push('1004'); // デフォルト: 戸建賃貸

    // 北海道の収益物件を検索
    // URL例: https://www.rakumachi.jp/syuuekibukken/area/prefecture/dimAll/?dim[]=1004&location_prefecture_id=1
    for (let page = 1; page <= maxPages; page++) {
      try {
        const sp = new URLSearchParams();
        sp.set('location_prefecture_id', '1'); // 北海道
        dims.forEach(d => sp.append('dim[]', d));
        if (page > 1) sp.set('page', String(page));
        sp.set('sort', 'property_created_at');
        sp.set('sort_type', 'desc');
        
        const url = `${this.baseUrl}/syuuekibukken/area/prefecture/dimAll/?${sp.toString()}`;
        console.log(`[rakumachi] Fetching page ${page}: ${url}`);
        const html = await fetchHtml(url);
        const results = this.parseSearchResults(html);
        console.log(`[rakumachi] Page ${page}: found ${results.length} listings`);
        if (results.length === 0) break;
        candidates.push(...results);
        await throttle(2000);
      } catch (e) {
        console.error(`[rakumachi] Error at page ${page}:`, e);
        break;
      }
    }
    console.log(`[rakumachi] Total candidates: ${candidates.length}`);
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    // 楽待の物件リンクパターン
    // 例: /syuuekibukken/hokkaido/hokkaido/dim1004/3029351/show.html
    const patterns = [
      /href="(\/syuuekibukken\/hokkaido\/[^"]*\/\d+\/show\.html)"/gi,
      /href="(\/syuuekibukken\/[^"]*dim\d+\/\d+\/show\.html)"/gi,
      /href="(\/syuuekibukken\/[^"]*\/\d+\/show\.html)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        const url = `${this.baseUrl}${m[1]}`;
        if (!results.some(r => r.url === url)) results.push({ url });
      }
    }
    return results;
  }

  async fetchDetail(url: string): Promise<ListingDetail> {
    const html = await fetchHtml(url);
    await throttle(1500);
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: this.extractPrice(html),
      address_raw: html.match(/所在地[：:\s]*([^<\n]+)/)?.[1]?.trim() || null,
      building_area: parseFloat(html.match(/建物面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      land_area: parseFloat(html.match(/土地面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      built_year: parseInt(html.match(/築年[月]?[：:\s]*(\d{4})年/)?.[1] || '', 10) || null,
      rooms: parseInt(html.match(/総戸数[：:\s]*(\d+)/)?.[1] || '1', 10),
      property_type: this.detectType(html),
      external_id: url.match(/\/(\d+)\/show\.html/)?.[1] || null,
      raw: { url, scraped_at: new Date().toISOString() },
    };
  }

  normalize(detail: ListingDetail): NormalizedListing {
    return {
      url: detail.url,
      title: detail.title,
      price: detail.price,
      external_id: detail.external_id || null,
      raw: detail.raw,
      property: {
        address_raw: detail.address_raw,
        normalized_address: normalizeAddress(detail.address_raw || ''),
        city: extractCity(detail.address_raw || ''),
        building_area: detail.building_area,
        land_area: detail.land_area,
        built_year: detail.built_year,
        rooms: detail.rooms,
        property_type: detail.property_type,
      },
    };
  }

  private extractPrice(html: string): number | null {
    const m = html.match(/([\d,]+)\s*万円/);
    if (m) {
      const p = parseInt(m[1].replace(/,/g, ''), 10) * 10000;
      if (p > 0 && p < 10000000000) return p;
    }
    return null;
  }

  private detectType(html: string): string | null {
    if (html.includes('一棟') || html.includes('アパート')) return 'アパート';
    if (html.includes('戸建')) return '一戸建て';
    if (html.includes('マンション')) return 'マンション';
    return null;
  }
}

// =============================================================================
// SUUMO
// =============================================================================
const SUUMO_PATHS: Record<string, string> = {
  '一戸建て': 'chukoikkodate',
  'マンション': 'chukomansion',
  '別荘': 'chukoikkodate',
};

export class SuumoConnector implements Connector {
  readonly key = 'suumo';
  readonly name = 'SUUMO';
  private baseUrl = 'https://suumo.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    const types = params.propertyTypes.length > 0 ? params.propertyTypes : ['一戸建て'];

    for (const t of types) {
      const path = SUUMO_PATHS[t] || 'chukoikkodate';
      for (let page = 1; page <= maxPages; page++) {
        try {
          const url = `${this.baseUrl}/${path}/hokkaido/${page > 1 ? `?pn=${page}` : ''}`;
          console.log(`[suumo] Fetching page ${page}`);
          const html = await fetchHtml(url);
          const results = this.parseSearchResults(html);
          if (results.length === 0) break;
          candidates.push(...results);
          await throttle(2000);
        } catch (e) {
          console.error(`[suumo] Error at page ${page}:`, e);
          break;
        }
      }
    }
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    const patterns = [
      /href="(https:\/\/suumo\.jp\/chukoikkodate\/[^"]+\.html)"/gi,
      /href="(https:\/\/suumo\.jp\/chukomansion\/[^"]+\.html)"/gi,
      /href="(\/(?:chukoikkodate|chukomansion)\/[^"]+\.html)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        const url = m[1].startsWith('/') ? `${this.baseUrl}${m[1]}` : m[1];
        if (!results.some(r => r.url === url)) results.push({ url });
      }
    }
    return results;
  }

  async fetchDetail(url: string): Promise<ListingDetail> {
    const html = await fetchHtml(url);
    await throttle(1500);
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: this.extractPrice(html),
      address_raw: html.match(/所在地[：:\s]*([^<\n]+)/)?.[1]?.trim() || null,
      building_area: parseFloat(html.match(/建物面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      land_area: parseFloat(html.match(/土地面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      built_year: parseInt(html.match(/築年月[：:\s]*(\d{4})年/)?.[1] || '', 10) || null,
      rooms: parseInt(html.match(/(\d+)[SLDK]+/i)?.[1] || '1', 10),
      property_type: url.includes('mansion') ? 'マンション' : '一戸建て',
      external_id: url.match(/(\d{10,})\.html/)?.[1] || null,
      raw: { url, scraped_at: new Date().toISOString() },
    };
  }

  normalize(detail: ListingDetail): NormalizedListing {
    return {
      url: detail.url, title: detail.title, price: detail.price,
      external_id: detail.external_id || null, raw: detail.raw,
      property: {
        address_raw: detail.address_raw,
        normalized_address: normalizeAddress(detail.address_raw || ''),
        city: extractCity(detail.address_raw || ''),
        building_area: detail.building_area, land_area: detail.land_area,
        built_year: detail.built_year, rooms: detail.rooms,
        property_type: detail.property_type,
      },
    };
  }

  private extractPrice(html: string): number | null {
    const m = html.match(/([\d,]+)\s*万円/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) * 10000 : null;
  }
}

// =============================================================================
// アットホーム
// =============================================================================
const ATHOME_PATHS: Record<string, string> = {
  '一戸建て': 'kodate/chuko',
  'マンション': 'mansion/chuko',
  '別荘': 'kodate/chuko',
};

export class AthomeConnector implements Connector {
  readonly key = 'athome';
  readonly name = 'アットホーム';
  private baseUrl = 'https://www.athome.co.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    const types = params.propertyTypes.length > 0 ? params.propertyTypes : ['一戸建て'];

    for (const t of types) {
      const path = ATHOME_PATHS[t] || 'kodate/chuko';
      for (let page = 1; page <= maxPages; page++) {
        try {
          const url = `${this.baseUrl}/${path}/hokkaido/list/${page > 1 ? `?page=${page}` : ''}`;
          console.log(`[athome] Fetching page ${page}`);
          const html = await fetchHtml(url);
          const results = this.parseSearchResults(html);
          if (results.length === 0) break;
          candidates.push(...results);
          await throttle(2000);
        } catch (e) {
          console.error(`[athome] Error:`, e);
          break;
        }
      }
    }
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    const patterns = [
      /href="(https:\/\/www\.athome\.co\.jp\/(?:kodate|mansion)\/\d+\/?[^"]*)"/gi,
      /href="(\/(?:kodate|mansion)\/\d+\/?[^"]*)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1].startsWith('/') ? `${this.baseUrl}${m[1]}` : m[1];
        url = url.split('?')[0];
        if (!results.some(r => r.url === url)) results.push({ url });
      }
    }
    return results;
  }

  async fetchDetail(url: string): Promise<ListingDetail> {
    const html = await fetchHtml(url);
    await throttle(1500);
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: this.extractPrice(html),
      address_raw: html.match(/所在地[：:\s]*([^<\n]+)/)?.[1]?.trim() || null,
      building_area: parseFloat(html.match(/建物面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      land_area: parseFloat(html.match(/土地面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      built_year: parseInt(html.match(/築年[月]?[：:\s]*(\d{4})年/)?.[1] || '', 10) || null,
      rooms: parseInt(html.match(/(\d+)[SLDK]+/i)?.[1] || '1', 10),
      property_type: url.includes('/mansion/') ? 'マンション' : '一戸建て',
      external_id: url.match(/\/(\d{8,})\/?$/)?.[1] || null,
      raw: { url, scraped_at: new Date().toISOString() },
    };
  }

  normalize(detail: ListingDetail): NormalizedListing {
    return {
      url: detail.url, title: detail.title, price: detail.price,
      external_id: detail.external_id || null, raw: detail.raw,
      property: {
        address_raw: detail.address_raw,
        normalized_address: normalizeAddress(detail.address_raw || ''),
        city: extractCity(detail.address_raw || ''),
        building_area: detail.building_area, land_area: detail.land_area,
        built_year: detail.built_year, rooms: detail.rooms,
        property_type: detail.property_type,
      },
    };
  }

  private extractPrice(html: string): number | null {
    const m = html.match(/([\d,]+)\s*万円/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) * 10000 : null;
  }
}

// =============================================================================
// LIFULL HOME'S
// =============================================================================
const HOMES_PATHS: Record<string, string> = {
  '一戸建て': 'kodate',
  'マンション': 'mansion',
  '別荘': 'kodate',
};

export class HomesConnector implements Connector {
  readonly key = 'homes';
  readonly name = 'LIFULL HOME\'S';
  private baseUrl = 'https://www.homes.co.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    const types = params.propertyTypes.length > 0 ? params.propertyTypes : ['一戸建て'];

    for (const t of types) {
      const path = HOMES_PATHS[t] || 'kodate';
      for (let page = 1; page <= maxPages; page++) {
        try {
          const url = page === 1 
            ? `${this.baseUrl}/${path}/b-1010101/` 
            : `${this.baseUrl}/${path}/b-1010101/list/?page=${page}`;
          console.log(`[homes] Fetching page ${page}`);
          const html = await fetchHtml(url);
          const results = this.parseSearchResults(html);
          if (results.length === 0) break;
          candidates.push(...results);
          await throttle(2000);
        } catch (e) {
          console.error(`[homes] Error:`, e);
          break;
        }
      }
    }
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    const patterns = [
      /href="(https:\/\/www\.homes\.co\.jp\/(?:kodate|mansion)\/b-\d+\/\d+\/?[^"]*)"/gi,
      /href="(\/(?:kodate|mansion)\/b-\d+\/\d+\/?[^"]*)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1].startsWith('/') ? `${this.baseUrl}${m[1]}` : m[1];
        url = url.split('?')[0];
        if (!results.some(r => r.url === url)) results.push({ url });
      }
    }
    return results;
  }

  async fetchDetail(url: string): Promise<ListingDetail> {
    const html = await fetchHtml(url);
    await throttle(1500);
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: this.extractPrice(html),
      address_raw: html.match(/所在地[：:\s]*([^<\n]+)/)?.[1]?.trim() || null,
      building_area: parseFloat(html.match(/建物面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      land_area: parseFloat(html.match(/土地面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      built_year: parseInt(html.match(/築年月[：:\s]*(\d{4})年/)?.[1] || '', 10) || null,
      rooms: parseInt(html.match(/(\d+)[SLDK]+/i)?.[1] || '1', 10),
      property_type: url.includes('/mansion/') ? 'マンション' : '一戸建て',
      external_id: url.match(/\/(\d{8,})\/?$/)?.[1] || null,
      raw: { url, scraped_at: new Date().toISOString() },
    };
  }

  normalize(detail: ListingDetail): NormalizedListing {
    return {
      url: detail.url, title: detail.title, price: detail.price,
      external_id: detail.external_id || null, raw: detail.raw,
      property: {
        address_raw: detail.address_raw,
        normalized_address: normalizeAddress(detail.address_raw || ''),
        city: extractCity(detail.address_raw || ''),
        building_area: detail.building_area, land_area: detail.land_area,
        built_year: detail.built_year, rooms: detail.rooms,
        property_type: detail.property_type,
      },
    };
  }

  private extractPrice(html: string): number | null {
    const m = html.match(/([\d,]+)\s*万円/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) * 10000 : null;
  }
}

// =============================================================================
// 北海道不動産連合隊
// =============================================================================
export class HokkaidoRengotaiConnector implements Connector {
  readonly key = 'hokkaido-rengotai';
  readonly name = '北海道不動産連合隊';
  private baseUrl = 'https://www.rengotai.com';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    const types = params.propertyTypes.length > 0 ? params.propertyTypes : ['一戸建て'];

    for (const t of types) {
      const path = t === 'マンション' ? 'mansion' : 'kodate';
      for (let page = 1; page <= maxPages; page++) {
        try {
          const url = `${this.baseUrl}/sale/${path}/${page > 1 ? `?page=${page}` : ''}`;
          console.log(`[rengotai] Fetching page ${page}`);
          const html = await fetchHtml(url);
          const results = this.parseSearchResults(html);
          if (results.length === 0) break;
          candidates.push(...results);
          await throttle(2000);
        } catch (e) {
          console.error(`[rengotai] Error:`, e);
          break;
        }
      }
    }
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    const patterns = [
      /href="(https:\/\/www\.rengotai\.com\/[^"]*detail[^"]*)"/gi,
      /href="(\/sale\/[^"]*\/\d+\/?[^"]*)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1].startsWith('/') ? `${this.baseUrl}${m[1]}` : m[1];
        url = url.split('?')[0];
        if (!results.some(r => r.url === url)) results.push({ url });
      }
    }
    return results;
  }

  async fetchDetail(url: string): Promise<ListingDetail> {
    const html = await fetchHtml(url);
    await throttle(1500);
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: this.extractPrice(html),
      address_raw: html.match(/所在地[：:\s]*([^<\n]+)/)?.[1]?.trim() || null,
      building_area: parseFloat(html.match(/建物面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      land_area: parseFloat(html.match(/土地面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      built_year: parseInt(html.match(/築年[：:\s]*(\d{4})年/)?.[1] || '', 10) || null,
      rooms: parseInt(html.match(/(\d+)[SLDK]+/i)?.[1] || '1', 10),
      property_type: url.includes('/mansion/') ? 'マンション' : '一戸建て',
      external_id: url.match(/\/(\d+)\/?$/)?.[1] || null,
      raw: { url, scraped_at: new Date().toISOString() },
    };
  }

  normalize(detail: ListingDetail): NormalizedListing {
    return {
      url: detail.url, title: detail.title, price: detail.price,
      external_id: detail.external_id || null, raw: detail.raw,
      property: {
        address_raw: detail.address_raw,
        normalized_address: normalizeAddress(detail.address_raw || ''),
        city: extractCity(detail.address_raw || ''),
        building_area: detail.building_area, land_area: detail.land_area,
        built_year: detail.built_year, rooms: detail.rooms,
        property_type: detail.property_type,
      },
    };
  }

  private extractPrice(html: string): number | null {
    const m = html.match(/([\d,]+)\s*万円/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) * 10000 : null;
  }
}

// =============================================================================
// ハウスドゥ
// =============================================================================
export class HousedoConnector implements Connector {
  readonly key = 'housedo';
  readonly name = 'ハウスドゥ';
  private baseUrl = 'https://www.housedo.co.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    const types = params.propertyTypes.length > 0 ? params.propertyTypes : ['一戸建て'];

    for (const t of types) {
      const path = t === 'マンション' ? 'mansion' : 'kodate';
      for (let page = 1; page <= maxPages; page++) {
        try {
          const url = `${this.baseUrl}/buy/hokkaido/${path}/${page > 1 ? `?page=${page}` : ''}`;
          console.log(`[housedo] Fetching page ${page}`);
          const html = await fetchHtml(url);
          const results = this.parseSearchResults(html);
          if (results.length === 0) break;
          candidates.push(...results);
          await throttle(2000);
        } catch (e) {
          console.error(`[housedo] Error:`, e);
          break;
        }
      }
    }
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    const patterns = [
      /href="(https:\/\/www\.housedo\.co\.jp\/buy\/[^"]*detail[^"]*)"/gi,
      /href="(\/buy\/[^"]*\/\d+\/?[^"]*)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1].startsWith('/') ? `${this.baseUrl}${m[1]}` : m[1];
        url = url.split('?')[0];
        if (!results.some(r => r.url === url)) results.push({ url });
      }
    }
    return results;
  }

  async fetchDetail(url: string): Promise<ListingDetail> {
    const html = await fetchHtml(url);
    await throttle(1500);
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: this.extractPrice(html),
      address_raw: html.match(/所在地[：:\s]*([^<\n]+)/)?.[1]?.trim() || null,
      building_area: parseFloat(html.match(/建物面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      land_area: parseFloat(html.match(/土地面積[：:\s]*([\d.]+)/)?.[1] || '') || null,
      built_year: parseInt(html.match(/築年[：:\s]*(\d{4})年/)?.[1] || '', 10) || null,
      rooms: parseInt(html.match(/(\d+)[SLDK]+/i)?.[1] || '1', 10),
      property_type: url.includes('/mansion/') ? 'マンション' : '一戸建て',
      external_id: url.match(/\/(\d+)\/?$/)?.[1] || null,
      raw: { url, scraped_at: new Date().toISOString() },
    };
  }

  normalize(detail: ListingDetail): NormalizedListing {
    return {
      url: detail.url, title: detail.title, price: detail.price,
      external_id: detail.external_id || null, raw: detail.raw,
      property: {
        address_raw: detail.address_raw,
        normalized_address: normalizeAddress(detail.address_raw || ''),
        city: extractCity(detail.address_raw || ''),
        building_area: detail.building_area, land_area: detail.land_area,
        built_year: detail.built_year, rooms: detail.rooms,
        property_type: detail.property_type,
      },
    };
  }

  private extractPrice(html: string): number | null {
    const m = html.match(/([\d,]+)\s*万円/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) * 10000 : null;
  }
}

// =============================================================================
// コネクター管理
// =============================================================================
const CONNECTORS: Record<string, Connector> = {
  kenbiya: new KenbiyaConnector(),
  rakumachi: new RakumachiConnector(),
  suumo: new SuumoConnector(),
  athome: new AthomeConnector(),
  homes: new HomesConnector(),
  'hokkaido-rengotai': new HokkaidoRengotaiConnector(),
  housedo: new HousedoConnector(),
};

export function getConnector(key: string): Connector | null {
  return CONNECTORS[key] || null;
}

export function getConnectors(enabledKeys: string[]): Connector[] {
  return enabledKeys.map(k => CONNECTORS[k]).filter((c): c is Connector => c !== undefined);
}

export function getAllConnectorKeys(): string[] {
  return Object.keys(CONNECTORS);
}
