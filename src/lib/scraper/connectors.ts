/**
 * 全ポータルサイトのコネクター
 * 実際のサイト構造に基づいて正確なURL生成
 */
import type { Connector, SearchParams, ListingCandidate, ListingDetail, NormalizedListing } from './types';
import { fetchHtml, throttle } from './http';
import { normalizeAddress, extractCity } from './normalize';

// =============================================================================
// 共通ユーティリティ
// =============================================================================
function extractPrice(html: string): number | null {
  // 複数パターンで価格を抽出
  const patterns = [
    /([\d,]+)\s*万円/,
    /価格[：:\s]*([\d,]+)\s*万/,
    /(\d{1,3}(?:,\d{3})*)\s*万/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const price = parseInt(m[1].replace(/,/g, ''), 10) * 10000;
      if (price > 0 && price < 10000000000) return price;
    }
  }
  return null;
}

function extractNumber(html: string, pattern: RegExp): number | null {
  const m = html.match(pattern);
  return m ? parseFloat(m[1]) : null;
}

function extractBuiltYear(html: string): number | null {
  const patterns = [
    /築[：:\s]*(\d{4})年/,
    /築年月[：:\s]*(\d{4})年/,
    /(\d{4})年[^\d]*築/,
    /築(\d{1,2})年/,  // 築XX年の場合は現在年から計算が必要だが一旦スキップ
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const year = parseInt(m[1], 10);
      if (year > 1900 && year < 2100) return year;
    }
  }
  return null;
}

function detectPropertyType(html: string): string | null {
  if (html.includes('一棟') || html.includes('アパート')) return 'アパート';
  if (html.includes('戸建') || html.includes('一軒家') || html.includes('一戸建')) return '一戸建て';
  if (html.includes('マンション')) return 'マンション';
  return null;
}

// =============================================================================
// SUUMO - https://suumo.jp/chukoikkodate/hokkaido/
// =============================================================================
export class SuumoConnector implements Connector {
  readonly key = 'suumo';
  readonly name = 'SUUMO';
  private baseUrl = 'https://suumo.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
    // 北海道の中古一戸建て: https://suumo.jp/chukoikkodate/hokkaido/
    // ページング: ?page=2, ?page=3 ...
    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = page === 1 
          ? `${this.baseUrl}/chukoikkodate/hokkaido/`
          : `${this.baseUrl}/chukoikkodate/hokkaido/?page=${page}`;
        console.log(`[suumo] Fetching page ${page}: ${url}`);
        const html = await fetchHtml(url);
        const results = this.parseSearchResults(html);
        console.log(`[suumo] Page ${page}: found ${results.length} listings`);
        if (results.length === 0) {
          console.log(`[suumo] No more results at page ${page}`);
          break;
        }
        candidates.push(...results);
        await throttle(2000);
      } catch (e) {
        console.error(`[suumo] Error at page ${page}:`, e);
        break;
      }
    }
    console.log(`[suumo] Total candidates: ${candidates.length}`);
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    // SUUMOの物件リンクパターン
    // 例: /chukoikkodate/hokkaido/sc_sapporo/nc_98765432/
    // 例: /chukoikkodate/__JJ_JJ010FJ001FC001_arz1030z2bsz1011z2...
    const patterns = [
      /href="(\/chukoikkodate\/hokkaido\/[^"]+nc_\d+[^"]*)"/gi,
      /href="(\/chukoikkodate\/[^"]*__[A-Z0-9_]+[^"]*)"/gi,
      /href="(https:\/\/suumo\.jp\/chukoikkodate\/[^"]+)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1];
        if (url.startsWith('/')) url = `${this.baseUrl}${url}`;
        // リスト系のURLは除外
        if (url.includes('/list/') || url.includes('?') || url.includes('/city/')) continue;
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
      title: html.match(/<h1[^>]*class="[^"]*heading[^"]*"[^>]*>([^<]+)/i)?.[1]?.trim() 
        || html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() 
        || '物件名不明',
      price: extractPrice(html),
      address_raw: html.match(/所在地[^<]*<[^>]*>([^<]+)/)?.[1]?.trim() 
        || html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*<[^>]*>([\d.]+)/),
      land_area: extractNumber(html, /土地面積[^<]*<[^>]*>([\d.]+)/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      property_type: '一戸建て',
      external_id: url.match(/nc_(\d+)/)?.[1] || null,
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
}

// =============================================================================
// アットホーム - https://www.athome.co.jp/kodate/chuko/hokkaido/list/
// =============================================================================
export class AthomeConnector implements Connector {
  readonly key = 'athome';
  readonly name = 'アットホーム';
  private baseUrl = 'https://www.athome.co.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
    // 北海道の中古一戸建て: https://www.athome.co.jp/kodate/chuko/hokkaido/list/
    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = page === 1 
          ? `${this.baseUrl}/kodate/chuko/hokkaido/list/`
          : `${this.baseUrl}/kodate/chuko/hokkaido/list/?page=${page}`;
        console.log(`[athome] Fetching page ${page}: ${url}`);
        const html = await fetchHtml(url);
        const results = this.parseSearchResults(html);
        console.log(`[athome] Page ${page}: found ${results.length} listings`);
        if (results.length === 0) break;
        candidates.push(...results);
        await throttle(2000);
      } catch (e) {
        console.error(`[athome] Error at page ${page}:`, e);
        break;
      }
    }
    console.log(`[athome] Total candidates: ${candidates.length}`);
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    // アットホームの物件リンクパターン
    // 例: /kodate/6979494919/
    const patterns = [
      /href="(\/kodate\/\d{8,}\/?)"/gi,
      /href="(https:\/\/www\.athome\.co\.jp\/kodate\/\d{8,}\/?)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1];
        if (url.startsWith('/')) url = `${this.baseUrl}${url}`;
        url = url.replace(/\/$/, '').replace(/\?.*$/, '') + '/';
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
      price: extractPrice(html),
      address_raw: html.match(/所在地[^<]*<[^>]*>([^<]+)/)?.[1]?.trim() 
        || html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*<[^>]*>([\d.]+)/),
      land_area: extractNumber(html, /土地面積[^<]*<[^>]*>([\d.]+)/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      property_type: '一戸建て',
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
}

// =============================================================================
// LIFULL HOME'S - https://www.homes.co.jp/kodate/chuko/hokkaido/list/
// =============================================================================
export class HomesConnector implements Connector {
  readonly key = 'homes';
  readonly name = "LIFULL HOME'S";
  private baseUrl = 'https://www.homes.co.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
    // 北海道の中古一戸建て
    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = page === 1 
          ? `${this.baseUrl}/kodate/chuko/hokkaido/list/`
          : `${this.baseUrl}/kodate/chuko/hokkaido/list/?page=${page}`;
        console.log(`[homes] Fetching page ${page}: ${url}`);
        const html = await fetchHtml(url);
        const results = this.parseSearchResults(html);
        console.log(`[homes] Page ${page}: found ${results.length} listings`);
        if (results.length === 0) break;
        candidates.push(...results);
        await throttle(2000);
      } catch (e) {
        console.error(`[homes] Error at page ${page}:`, e);
        break;
      }
    }
    console.log(`[homes] Total candidates: ${candidates.length}`);
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    // ホームズの物件リンクパターン
    // 例: /kodate/b-1312130000034/
    const patterns = [
      /href="(\/kodate\/b-\d+\/?)"/gi,
      /href="(https:\/\/www\.homes\.co\.jp\/kodate\/b-\d+\/?)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1];
        if (url.startsWith('/')) url = `${this.baseUrl}${url}`;
        url = url.replace(/\?.*$/, '');
        if (!url.endsWith('/')) url += '/';
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
      price: extractPrice(html),
      address_raw: html.match(/所在地[^<]*<[^>]*>([^<]+)/)?.[1]?.trim() 
        || html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*<[^>]*>([\d.]+)/),
      land_area: extractNumber(html, /土地面積[^<]*<[^>]*>([\d.]+)/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      property_type: '一戸建て',
      external_id: url.match(/b-(\d+)/)?.[1] || null,
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
}

// =============================================================================
// 健美家（Kenbiya）- https://www.kenbiya.com/
// =============================================================================
export class KenbiyaConnector implements Connector {
  readonly key = 'kenbiya';
  readonly name = '健美家';
  private baseUrl = 'https://www.kenbiya.com';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
    // 北海道の収益物件（戸建賃貸）
    // URL例: https://www.kenbiya.com/list/hokkaido/?is_kodate=1
    for (let page = 1; page <= maxPages; page++) {
      try {
        const sp = new URLSearchParams();
        sp.set('is_kodate', '1'); // 戸建
        sp.set('sort', '1'); // 新着順
        if (page > 1) sp.set('page', String(page));
        
        const url = `${this.baseUrl}/list/hokkaido/?${sp.toString()}`;
        console.log(`[kenbiya] Fetching page ${page}: ${url}`);
        const html = await fetchHtml(url);
        const results = this.parseSearchResults(html);
        console.log(`[kenbiya] Page ${page}: found ${results.length} listings`);
        if (results.length === 0) break;
        candidates.push(...results);
        await throttle(2000);
      } catch (e) {
        console.error(`[kenbiya] Error at page ${page}:`, e);
        break;
      }
    }
    console.log(`[kenbiya] Total candidates: ${candidates.length}`);
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    // 健美家の物件リンクパターン
    // 例: /property/detail/01234567/
    const patterns = [
      /href="(\/property\/detail\/\d+\/?)"/gi,
      /href="(https:\/\/www\.kenbiya\.com\/property\/detail\/\d+\/?)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1];
        if (url.startsWith('/')) url = `${this.baseUrl}${url}`;
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
      price: extractPrice(html),
      address_raw: html.match(/所在地[^<]*<[^>]*>([^<]+)/)?.[1]?.trim() 
        || html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*<[^>]*>([\d.]+)/),
      land_area: extractNumber(html, /土地面積[^<]*<[^>]*>([\d.]+)/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /総戸数[^<]*(\d+)/) || 1,
      property_type: detectPropertyType(html) || '一戸建て',
      external_id: url.match(/detail\/(\d+)/)?.[1] || null,
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
}

// =============================================================================
// 楽待（Rakumachi）- https://www.rakumachi.jp/
// =============================================================================
export class RakumachiConnector implements Connector {
  readonly key = 'rakumachi';
  readonly name = '楽待';
  private baseUrl = 'https://www.rakumachi.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;

    // 北海道の収益物件
    // URL例: https://www.rakumachi.jp/syuuekibukken/area/prefecture/dimAll/?dim[]=1004&location_prefecture_id=1
    for (let page = 1; page <= maxPages; page++) {
      try {
        const sp = new URLSearchParams();
        sp.set('location_prefecture_id', '1'); // 北海道
        sp.append('dim[]', '1004'); // 戸建賃貸
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
      price: extractPrice(html),
      address_raw: html.match(/所在地[^<]*<[^>]*>([^<]+)/)?.[1]?.trim() 
        || html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*<[^>]*>([\d.]+)/),
      land_area: extractNumber(html, /土地面積[^<]*<[^>]*>([\d.]+)/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /総戸数[^<]*(\d+)/) || 1,
      property_type: detectPropertyType(html) || '一戸建て',
      external_id: url.match(/\/(\d+)\/show\.html/)?.[1] || null,
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
}

// =============================================================================
// 札幌不動産連合隊 - https://fudosanlist.cbiz.ne.jp/
// =============================================================================
export class HokkaidoRengotaiConnector implements Connector {
  readonly key = 'hokkaido-rengotai';
  readonly name = '札幌不動産連合隊';
  private baseUrl = 'https://fudosanlist.cbiz.ne.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
    // 札幌の売買物件（一戸建て）
    // URL例: https://fudosanlist.cbiz.ne.jp/list/sale/?prop=1&nstg=2&area=sapporo
    for (let page = 1; page <= maxPages; page++) {
      try {
        const sp = new URLSearchParams();
        sp.set('prop', '1'); // 一戸建て
        sp.set('nstg', '2'); // 中古
        sp.set('area', 'sapporo'); // 札幌
        if (page > 1) sp.set('page', String(page));
        
        const url = `${this.baseUrl}/list/sale/?${sp.toString()}`;
        console.log(`[rengotai] Fetching page ${page}: ${url}`);
        const html = await fetchHtml(url);
        const results = this.parseSearchResults(html);
        console.log(`[rengotai] Page ${page}: found ${results.length} listings`);
        if (results.length === 0) break;
        candidates.push(...results);
        await throttle(2000);
      } catch (e) {
        console.error(`[rengotai] Error at page ${page}:`, e);
        break;
      }
    }
    console.log(`[rengotai] Total candidates: ${candidates.length}`);
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    // 札幌不動産連合隊の物件リンクパターン
    // 例: /detail/sale/123456/
    const patterns = [
      /href="(\/detail\/sale\/\d+\/?)"/gi,
      /href="(https:\/\/fudosanlist\.cbiz\.ne\.jp\/detail\/sale\/\d+\/?)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1];
        if (url.startsWith('/')) url = `${this.baseUrl}${url}`;
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
      price: extractPrice(html),
      address_raw: html.match(/所在地[^<]*<[^>]*>([^<]+)/)?.[1]?.trim() 
        || html.match(/北海道[^\s<]+/)?.[0] 
        || html.match(/札幌市[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*<[^>]*>([\d.]+)/),
      land_area: extractNumber(html, /土地面積[^<]*<[^>]*>([\d.]+)/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      property_type: '一戸建て',
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
}

// =============================================================================
// ハウスドゥ - https://www.housedo.com/
// =============================================================================
export class HousedoConnector implements Connector {
  readonly key = 'housedo';
  readonly name = 'ハウスドゥ';
  private baseUrl = 'https://www.housedo.com';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
    // 北海道の中古一戸建て
    // URL例: https://www.housedo.com/used_ikkodate/hokkaido/list/
    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = page === 1 
          ? `${this.baseUrl}/used_ikkodate/hokkaido/list/`
          : `${this.baseUrl}/used_ikkodate/hokkaido/list/?page=${page}`;
        console.log(`[housedo] Fetching page ${page}: ${url}`);
        const html = await fetchHtml(url);
        const results = this.parseSearchResults(html);
        console.log(`[housedo] Page ${page}: found ${results.length} listings`);
        if (results.length === 0) break;
        candidates.push(...results);
        await throttle(2000);
      } catch (e) {
        console.error(`[housedo] Error at page ${page}:`, e);
        break;
      }
    }
    console.log(`[housedo] Total candidates: ${candidates.length}`);
    return candidates.filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i);
  }

  private parseSearchResults(html: string): ListingCandidate[] {
    const results: ListingCandidate[] = [];
    // ハウスドゥの物件リンクパターン
    // 例: /used_ikkodate/detail/12345678/
    const patterns = [
      /href="(\/used_ikkodate\/detail\/\d+\/?)"/gi,
      /href="(https:\/\/www\.housedo\.com\/used_ikkodate\/detail\/\d+\/?)"/gi,
      /href="(\/[^"]*\/detail\/\d+\/?)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1];
        if (url.startsWith('/')) url = `${this.baseUrl}${url}`;
        // リスト系のURLは除外
        if (url.includes('/list/')) continue;
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
      price: extractPrice(html),
      address_raw: html.match(/所在地[^<]*<[^>]*>([^<]+)/)?.[1]?.trim() 
        || html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*<[^>]*>([\d.]+)/),
      land_area: extractNumber(html, /土地面積[^<]*<[^>]*>([\d.]+)/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      property_type: '一戸建て',
      external_id: url.match(/detail\/(\d+)/)?.[1] || null,
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
}

// =============================================================================
// コネクター管理
// =============================================================================
const CONNECTORS: Record<string, Connector> = {
  suumo: new SuumoConnector(),
  athome: new AthomeConnector(),
  homes: new HomesConnector(),
  kenbiya: new KenbiyaConnector(),
  rakumachi: new RakumachiConnector(),
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
