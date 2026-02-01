/**
 * 全ポータルサイトのコネクター
 * 実際のHTMLから抽出したパターンを使用
 */
import type { Connector, SearchParams, ListingCandidate, ListingDetail, NormalizedListing } from './types';
import { fetchHtml, throttle } from './http';
import { normalizeAddress, extractCity } from './normalize';

// =============================================================================
// 共通ユーティリティ
// =============================================================================
function extractPrice(html: string): number | null {
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
    /建築年[（(]?築年数[）)]?[：:\s]*(\d{4})年/,
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
// SUUMO - https://suumo.jp/chukoikkodate/hokkaido_/city/
// 札幌市: https://suumo.jp/chukoikkodate/hokkaido_/sa_sapporo/
// =============================================================================
export class SuumoConnector implements Connector {
  readonly key = 'suumo';
  readonly name = 'SUUMO';
  private baseUrl = 'https://suumo.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
    // 北海道の中古一戸建て検索（札幌市全区）
    // sc=01101〜01110 は札幌市の各区コード
    for (let page = 1; page <= maxPages; page++) {
      try {
        const baseParams = 'ar=010&bs=021&ta=01&sc=01101&sc=01102&sc=01103&sc=01104&sc=01105&sc=01106&sc=01107&sc=01108&sc=01109&sc=01110';
        const url = page === 1 
          ? `${this.baseUrl}/jj/bukken/ichiran/JJ010FJ001/?${baseParams}`
          : `${this.baseUrl}/jj/bukken/ichiran/JJ010FJ001/?${baseParams}&pn=${page}`;
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
    // SUUMOの物件詳細リンクパターン: /jj/bukken/shousai/JJ012FD001/?...&nc=XXXXXXXX
    // または資料請求リンクから物件番号を抽出: nc=XXXXXXXX
    const ncPattern = /nc=(\d{8})/g;
    const foundNcs = new Set<string>();
    for (const m of html.matchAll(ncPattern)) {
      foundNcs.add(m[1]);
    }
    for (const nc of foundNcs) {
      // 物件詳細URLを構築
      const url = `${this.baseUrl}/jj/bukken/shousai/JJ012FD001/?ar=010&bs=021&nc=${nc}`;
      results.push({ url });
    }
    console.log(`[suumo] parseSearchResults found ${results.length} unique property IDs`);
    return results;
  }

  async fetchDetail(url: string): Promise<ListingDetail> {
    const html = await fetchHtml(url);
    await throttle(1500);
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: extractPrice(html),
      address_raw: html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      property_type: '一戸建て',
      external_id: url.match(/__JJ_([^/]+)/)?.[1] || null,
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
// 物件URL: /kodate/6988076260/
// =============================================================================
export class AthomeConnector implements Connector {
  readonly key = 'athome';
  readonly name = 'アットホーム';
  private baseUrl = 'https://www.athome.co.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
    for (let page = 1; page <= maxPages; page++) {
      try {
        // アットホームのページネーション: /list/, /list/page2/, /list/page3/...
        const url = page === 1 
          ? `${this.baseUrl}/kodate/chuko/hokkaido/list/`
          : `${this.baseUrl}/kodate/chuko/hokkaido/list/page${page}/`;
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
    // アットホームの物件リンク: /kodate/6988076260/?DOWN=1&... または /kodate/6988076260/
    // IDは10桁の数字
    const pattern = /\/kodate\/(\d{10})(?:\/|\?)/g;
    for (const m of html.matchAll(pattern)) {
      const url = `${this.baseUrl}/kodate/${m[1]}/`;
      if (!results.some(r => r.url === url)) {
        results.push({ url });
      }
    }
    console.log(`[athome] parseSearchResults found ${results.length} unique links`);
    return results;
  }

  async fetchDetail(url: string): Promise<ListingDetail> {
    const html = await fetchHtml(url);
    await throttle(1500);
    
    // アットホームの住所パターン: 「所在地」の後に「北海道...」
    let address = null;
    const addressPatterns = [
      /所在地[^北海道]*北海道([^<\|]+)/i,
      /北海道[^\s,<\|]+市[^\s,<\|]+/,
      /北海道[^\s,<\|]+町[^\s,<\|]*/,
      /北海道[^\s,<\|]+村[^\s,<\|]*/,
    ];
    for (const p of addressPatterns) {
      const m = html.match(p);
      if (m) {
        address = m[0].includes('所在地') ? `北海道${m[1].trim()}` : m[0].trim();
        break;
      }
    }
    
    // タイトル: h1またはページタイトルから
    let title = html.match(/<h1[^>]*class="[^"]*heading[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim();
    if (!title) title = html.match(/<title>([^<]+)</i)?.[1]?.split('|')[0]?.trim();
    if (!title) title = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim();
    
    return {
      url,
      title: title || '物件名不明',
      price: extractPrice(html),
      address_raw: address,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      property_type: '一戸建て',
      external_id: url.match(/\/kodate\/(\d{10})\//)?.[1] || null,
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
// 物件URL: /kodate/b-1471480000509/
// =============================================================================
export class HomesConnector implements Connector {
  readonly key = 'homes';
  readonly name = "LIFULL HOME'S";
  private baseUrl = 'https://www.homes.co.jp';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
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
    // ホームズの物件リンク: /kodate/b-1471480000509/
    const patterns = [
      /href="(https:\/\/www\.homes\.co\.jp\/kodate\/b-\d+[^"]*)"/gi,
      /href="(\/kodate\/b-\d+[^"]*)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1];
        if (url.startsWith('/')) url = `${this.baseUrl}${url}`;
        // クエリパラメータを除去
        url = url.split('?')[0];
        if (!url.endsWith('/')) url += '/';
        if (!results.some(r => r.url === url)) results.push({ url });
      }
    }
    return results;
  }

  async fetchDetail(url: string): Promise<ListingDetail> {
    const html = await fetchHtml(url);
    await throttle(1500);
    
    // ホームズのタイトル: ページタイトルから取得（「【ホームズ】物件名｜...」形式）
    let title = null;
    const titleMatch = html.match(/<title>(?:【ホームズ】)?([^｜<]+)/i);
    if (titleMatch) title = titleMatch[1].trim();
    if (!title) {
      const h1Match = html.match(/中古一戸建て([^0-9<]+)/i);
      if (h1Match) title = h1Match[1].trim();
    }
    
    // 住所: 「所在地」の後または「北海道...」パターン
    let address = null;
    const addressPatterns = [
      /所在地[^北海道]*?(北海道[^\s<\|]+)/i,
      /北海道[^\s,<\|]+(?:市|町|村)[^\s,<\|]*/,
    ];
    for (const p of addressPatterns) {
      const m = html.match(p);
      if (m) {
        address = m[1] || m[0];
        break;
      }
    }
    
    return {
      url,
      title: title || '物件名不明',
      price: extractPrice(html),
      address_raw: address,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
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
// 健美家（Kenbiya）- https://www.kenbiya.com/list/hokkaido/
// =============================================================================
export class KenbiyaConnector implements Connector {
  readonly key = 'kenbiya';
  readonly name = '健美家';
  private baseUrl = 'https://www.kenbiya.com';

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    
    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = page === 1 
          ? `${this.baseUrl}/list/hokkaido/?dim=8`
          : `${this.baseUrl}/list/hokkaido/?dim=8&page=${page}`;
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
    const patterns = [
      /href="(\/property\/\d+\/)"/gi,
      /href="(https:\/\/www\.kenbiya\.com\/property\/\d+\/)"/gi,
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
      address_raw: html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /総戸数[^<]*(\d+)/) || 1,
      property_type: detectPropertyType(html) || '一戸建て',
      external_id: url.match(/\/property\/(\d+)\//)?.[1] || null,
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

    for (let page = 1; page <= maxPages; page++) {
      try {
        const sp = new URLSearchParams();
        sp.set('location_prefecture_id', '1');
        sp.append('dim[]', '1004');
        if (page > 1) sp.set('page', String(page));
        sp.set('sort', 'property_created_at');
        sp.set('sort_type', 'desc');
        
        const url = `${this.baseUrl}/syuuekibukken/area/prefecture/dimAll/?${sp.toString()}`;
        console.log(`[rakumachi] Fetching page ${page}`);
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
      address_raw: html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
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
    
    for (let page = 1; page <= maxPages; page++) {
      try {
        const sp = new URLSearchParams();
        sp.set('prop', '1');
        sp.set('nstg', '2');
        sp.set('area', 'sapporo');
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
    const patterns = [
      /href="(\/detail\/[^"]+)"/gi,
      /href="(https:\/\/fudosanlist\.cbiz\.ne\.jp\/detail\/[^"]+)"/gi,
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
      address_raw: html.match(/北海道[^\s<]+/)?.[0] 
        || html.match(/札幌市[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
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
    
    // 北海道: 札幌市北区の例
    // https://www.housedo.com/%E6%9C%AD%E5%B9%8C%E5%B8%82%E5%8C%97%E5%8C%BA/list/
    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = page === 1 
          ? `${this.baseUrl}/used_ikkodate/`
          : `${this.baseUrl}/used_ikkodate/?page=${page}`;
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
    // ハウスドゥの物件詳細ページ
    const patterns = [
      /href="(https:\/\/www\.housedo\.com\/[^"]*\/detail\/\d+\/)"/gi,
      /href="(\/[^"]*\/detail\/\d+\/)"/gi,
    ];
    for (const p of patterns) {
      for (const m of html.matchAll(p)) {
        let url = m[1];
        if (url.startsWith('/')) url = `${this.baseUrl}${url}`;
        // 北海道の物件のみ
        if (url.includes('hokkaido') || url.includes('%E5%8C%97%E6%B5%B7%E9%81%93') || url.includes('%E6%9C%AD%E5%B9%8C')) {
          if (!results.some(r => r.url === url)) results.push({ url });
        }
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
      address_raw: html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
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
