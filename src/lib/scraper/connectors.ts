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

/**
 * アットホーム専用の価格抽出
 * 物件概要テーブル内の価格を優先的に取得
 */
function extractPriceAthome(html: string): number | null {
  // アットホームの価格表示パターン（物件概要セクション）
  const athomePatterns = [
    // テーブル形式: | 価格 | の行の後に X万円
    /[|｜]\s*価格\s*[|｜][\s\S]{0,50}?([\d,]+)\s*万円/,
    // 価格ヘッダーの下に値
    /価格<\/t[hd]>\s*<t[hd][^>]*>\s*([\d,]+)\s*万円/i,
    // 単独の価格表示（物件詳細部）
    />\s*([\d,]+)\s*万円\s*</,
    // data属性やclass内の価格
    /data-price[^>]*>([\d,]+)\s*万円/i,
    // 価格クラス内
    /class="[^"]*price[^"]*"[^>]*>([\d,]+)\s*万円/i,
  ];
  
  for (const p of athomePatterns) {
    const m = html.match(p);
    if (m) {
      const price = parseInt(m[1].replace(/,/g, ''), 10) * 10000;
      if (price > 0 && price < 10000000000) return price;
    }
  }
  return null;
}

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

/**
 * アットホーム専用の建物面積抽出
 * 複数のパターンに対応
 */
function extractBuildingAreaAthome(html: string): number | null {
  const patterns = [
    // テーブル形式: 建物面積</th><td>XXX.XX㎡ or m²
    /建物面積<\/t[hd]>\s*<t[hd][^>]*>\s*([\d,.]+)\s*[㎡m²]/i,
    // パイプ区切り形式（テキスト）
    /建物面積[：:\s|｜]*([\d,.]+)\s*[㎡m²]/i,
    // 一般的な形式
    /建物面積[^<\d]*([\d,.]+)\s*[㎡m²]/i,
    // m だけの場合
    /建物面積[^<\d]*([\d,.]+)\s*m(?![²㎡a-zA-Z])/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const area = parseFloat(m[1].replace(/,/g, ''));
      if (area > 0 && area < 10000) return area;
    }
  }
  return null;
}

/**
 * アットホーム専用の土地面積抽出
 */
function extractLandAreaAthome(html: string): number | null {
  const patterns = [
    /土地面積<\/t[hd]>\s*<t[hd][^>]*>\s*([\d,.]+)\s*[㎡m²]/i,
    /土地面積[：:\s|｜]*([\d,.]+)\s*[㎡m²]/i,
    /土地面積[^<\d]*([\d,.]+)\s*[㎡m²]/i,
    /土地面積[^<\d]*([\d,.]+)\s*m(?![²㎡a-zA-Z])/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const area = parseFloat(m[1].replace(/,/g, ''));
      if (area > 0 && area < 100000) return area;
    }
  }
  return null;
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
  // より詳細な物件タイプ検出
  if (html.includes('一棟マンション')) return '一棟マンション';
  if (html.includes('一棟アパート')) return '一棟アパート';
  if (html.includes('一棟') && html.includes('アパート')) return '一棟アパート';
  if (html.includes('一棟') && html.includes('マンション')) return '一棟マンション';
  if (html.includes('一棟')) return '一棟集合住宅';
  if (html.includes('戸建') || html.includes('一軒家') || html.includes('一戸建')) return '中古戸建て';
  if (html.includes('マンション')) return 'マンション';
  if (html.includes('アパート')) return 'アパート';
  return null;
}

/**
 * 最寄駅と徒歩分数を抽出
 */
function extractStationInfo(html: string): { station: string | null; walkMinutes: number | null } {
  // まず「交通」項目からテキストを抽出（テーブル形式）
  const transportPatterns = [
    // 北海道不動産連合隊: <th>交通</th><td>JR函館本線「南小樽」駅 徒歩5分</td>
    /交通<\/t[hd]>\s*<t[hd][^>]*>([^<]+)</i,
    // th/td間にタグがある場合
    /交通<\/th>[\s\S]*?<td[^>]*>([^<]+)</i,
    // dt/dd形式
    /<dt[^>]*>交通<\/dt>\s*<dd[^>]*>([^<]+)</i,
    // テキスト形式: 交通：○○
    /交通[：:]\s*([^\n<]+)/,
  ];
  
  let transportText = '';
  for (const p of transportPatterns) {
    const m = html.match(p);
    if (m && m[1]) {
      transportText = m[1].trim();
      break;
    }
  }
  
  // 交通テキストから駅名と徒歩分数を抽出
  if (transportText) {
    // JR函館本線「南小樽」駅 徒歩5分 のようなパターン
    const stationPatterns = [
      // 「駅名」駅 徒歩X分
      /「([^」]+)」駅?\s*徒歩\s*(\d+)\s*分/,
      // 駅名駅 徒歩X分
      /([^\s「」]+駅)\s*徒歩\s*(\d+)\s*分/,
      // ○○線 駅名 徒歩X分
      /[^\s]+線\s*「?([^」\s]+)」?駅?\s*徒歩\s*(\d+)\s*分/,
      // バス停 徒歩X分（バスの場合）
      /「([^」]+)」\s*(?:バス停|停留所)?\s*徒歩\s*(\d+)\s*分/,
    ];
    
    for (const p of stationPatterns) {
      const m = transportText.match(p);
      if (m) {
        let station = m[1]?.trim();
        if (station && !station.endsWith('駅')) {
          station += '駅';
        }
        const walkMinutes = m[2] ? parseInt(m[2], 10) : null;
        if (station) {
          return { station, walkMinutes };
        }
      }
    }
    
    // 徒歩分数のみの場合
    const walkMatch = transportText.match(/徒歩\s*(\d+)\s*分/);
    if (walkMatch) {
      // 駅名を抽出（徒歩の前の部分）
      const stationMatch = transportText.match(/「([^」]+)」/);
      let station = stationMatch ? stationMatch[1] + '駅' : null;
      return { station, walkMinutes: parseInt(walkMatch[1], 10) };
    }
    
    // 交通テキストをそのまま駅名として使用（徒歩分数なし）
    if (transportText.length < 50) {
      return { station: transportText, walkMinutes: null };
    }
  }
  
  // フォールバック: HTML全体から抽出
  const fallbackPatterns = [
    // 「○○駅」徒歩X分
    /([^\s<>「」]+駅)[^<>]*?徒歩\s*(\d+)\s*分/,
    // ○○駅 徒歩X分
    /([^\s<>]+駅)\s*徒歩\s*(\d+)\s*分/,
    // 地下鉄○○線「○○」駅
    /地下鉄[^\s<>]+線[「『]?([^」』<>]+)[」』]?駅[^<>]*?徒歩\s*(\d+)\s*分/,
  ];
  
  for (const p of fallbackPatterns) {
    const m = html.match(p);
    if (m) {
      let station = m[1]?.trim();
      if (station && !station.endsWith('駅')) {
        station += '駅';
      }
      const walkMinutes = m[2] ? parseInt(m[2], 10) : null;
      if (station) {
        return { station, walkMinutes };
      }
    }
  }
  
  // 徒歩分数のみ取得できる場合
  const walkOnlyMatch = html.match(/徒歩\s*(\d+)\s*分/);
  if (walkOnlyMatch) {
    return { station: null, walkMinutes: parseInt(walkOnlyMatch[1], 10) };
  }
  
  return { station: null, walkMinutes: null };
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
    const stationInfo = extractStationInfo(html);
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: extractPrice(html),
      address_raw: html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      units: 1,  // 中古戸建ては常に1戸
      num_rooms: extractNumber(html, /(\d+)[SLDK]+/) || null,  // 間取りから部屋数
      nearest_station: stationInfo.station,
      walk_minutes: stationInfo.walkMinutes,
      property_type: '中古戸建て',
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
        units: detail.units, num_rooms: detail.num_rooms,
        nearest_station: detail.nearest_station,
        walk_minutes: detail.walk_minutes,
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
    
    // customUrlが指定されている場合はそのURLを使用（1ページのみ）
    if (params.customUrl) {
      try {
        console.log(`[athome] Fetching custom URL: ${params.customUrl}`);
        const html = await fetchHtml(params.customUrl);
        const results = this.parseSearchResults(html);
        console.log(`[athome] Custom URL: found ${results.length} listings`);
        return results;
      } catch (e) {
        console.error(`[athome] Error fetching custom URL:`, e);
        return [];
      }
    }
    
    // デフォルト: 北海道全体を巡回
    for (let page = 1; page <= maxPages; page++) {
      try {
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
      // テーブル形式: 所在地 | 北海道XXX or 所在地｜北海道XXX
      /所在地[|\s｜]+北海道([^\n|｜<]+)/i,
      // 所在地の後に北海道（HTMLタグ間）
      /所在地[^北海道]{0,20}北海道([^<\n]{3,50})/i,
      // 単独の住所パターン
      /北海道[^\s,<\|｜\n]+[市町村][^\s,<\|｜\n]*/,
    ];
    for (const p of addressPatterns) {
      const m = html.match(p);
      if (m) {
        if (m[1]) {
          address = `北海道${m[1].trim().replace(/\s+/g, '')}`;
        } else {
          address = m[0].trim().replace(/\s+/g, '');
        }
        break;
      }
    }
    
    // タイトル: ページタイトルから優先（より確実）
    let title = html.match(/<title>([^<]+)</i)?.[1]?.replace(/[\[【].+$/, '').replace(/\s*\|.+$/, '').trim();
    if (!title || title.includes('アットホーム')) {
      title = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim();
    }
    if (!title) {
      title = html.match(/<h1[^>]*class="[^"]*heading[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim();
    }
    
    // アットホーム専用の価格抽出（フォールバック付き）
    const price = extractPriceAthome(html) || extractPrice(html);
    
    // アットホーム専用の面積抽出（フォールバック付き）
    const buildingArea = extractBuildingAreaAthome(html) || extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/);
    const landArea = extractLandAreaAthome(html) || extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/);
    
    const stationInfo = extractStationInfo(html);
    
    return {
      url,
      title: title || '物件名不明',
      price,
      address_raw: address,
      building_area: buildingArea,
      land_area: landArea,
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      units: 1,  // 中古戸建ては常に1戸
      num_rooms: extractNumber(html, /(\d+)[SLDK]+/) || null,  // 間取りから部屋数
      nearest_station: stationInfo.station,
      walk_minutes: stationInfo.walkMinutes,
      property_type: '中古戸建て',
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
        units: detail.units, num_rooms: detail.num_rooms,
        nearest_station: detail.nearest_station,
        walk_minutes: detail.walk_minutes,
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
    
    const stationInfo = extractStationInfo(html);
    
    return {
      url,
      title: title || '物件名不明',
      price: extractPrice(html),
      address_raw: address,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      units: 1,  // 中古戸建ては常に1戸
      num_rooms: extractNumber(html, /(\d+)[SLDK]+/) || null,  // 間取りから部屋数
      nearest_station: stationInfo.station,
      walk_minutes: stationInfo.walkMinutes,
      property_type: '中古戸建て',
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
        units: detail.units, num_rooms: detail.num_rooms,
        nearest_station: detail.nearest_station,
        walk_minutes: detail.walk_minutes,
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
    const propertyType = detectPropertyType(html) || '一棟集合住宅';
    const isKodate = propertyType.includes('戸建');
    const totalUnits = extractNumber(html, /総戸数[^<]*(\d+)/);
    const numRoomsFromLayout = extractNumber(html, /(\d+)[SLDK]+/);
    const stationInfo = extractStationInfo(html);
    
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: extractPrice(html),
      address_raw: html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
      built_year: extractBuiltYear(html),
      rooms: isKodate ? numRoomsFromLayout : totalUnits,  // 後方互換性
      units: isKodate ? 1 : (totalUnits || 1),  // 戸建=1、集合=総戸数
      num_rooms: isKodate ? numRoomsFromLayout : null,  // 戸建=間取り、集合=null
      nearest_station: stationInfo.station,
      walk_minutes: stationInfo.walkMinutes,
      property_type: propertyType,
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
        units: detail.units, num_rooms: detail.num_rooms,
        nearest_station: detail.nearest_station,
        walk_minutes: detail.walk_minutes,
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
    const propertyType = detectPropertyType(html) || '一棟集合住宅';
    const isKodate = propertyType.includes('戸建');
    const totalUnits = extractNumber(html, /総戸数[^<]*(\d+)/);
    const numRoomsFromLayout = extractNumber(html, /(\d+)[SLDK]+/);
    const stationInfo = extractStationInfo(html);
    
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: extractPrice(html),
      address_raw: html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
      built_year: extractBuiltYear(html),
      rooms: isKodate ? numRoomsFromLayout : totalUnits,  // 後方互換性
      units: isKodate ? 1 : (totalUnits || 1),  // 戸建=1、集合=総戸数
      num_rooms: isKodate ? numRoomsFromLayout : null,  // 戸建=間取り、集合=null
      nearest_station: stationInfo.station,
      walk_minutes: stationInfo.walkMinutes,
      property_type: propertyType,
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
        units: detail.units, num_rooms: detail.num_rooms,
        nearest_station: detail.nearest_station,
        walk_minutes: detail.walk_minutes,
        property_type: detail.property_type,
      },
    };
  }
}

// =============================================================================
// 札幌不動産連合隊 - https://fudosanlist.cbiz.ne.jp/
// prop=1: 土地, prop=2: 一戸建て, prop=3: マンション, prop=4: 一棟マンション, prop=5: 一棟アパート
// =============================================================================
export class HokkaidoRengotaiConnector implements Connector {
  readonly key = 'hokkaido-rengotai';
  readonly name = '札幌不動産連合隊';
  private baseUrl = 'https://fudosanlist.cbiz.ne.jp';

  // 物件タイプをURLパラメータにマッピング
  private getPropParams(propertyTypes: string[]): string[] {
    const props: string[] = [];
    for (const pt of propertyTypes) {
      if (pt.includes('戸建')) {
        props.push('2');  // 一戸建て
      }
      if (pt.includes('一棟') || pt.includes('集合') || pt.includes('マンション') || pt.includes('アパート')) {
        props.push('4');  // 一棟マンション
        props.push('5');  // 一棟アパート
      }
    }
    return [...new Set(props)];  // 重複排除
  }

  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 200;
    const propParams = this.getPropParams(params.propertyTypes);
    
    // 物件タイプが指定されていない場合はデフォルトで戸建てと一棟
    if (propParams.length === 0) {
      propParams.push('2', '4', '5');
    }
    
    console.log(`[rengotai] Property types: ${params.propertyTypes.join(', ')} -> prop=${propParams.join(',')}`);
    
    // 各物件タイプごとに検索
    for (const prop of propParams) {
      for (let page = 1; page <= maxPages; page++) {
        try {
          const sp = new URLSearchParams();
          sp.set('prop', prop);
          sp.set('nstg', '2');  // 中古
          if (page > 1) sp.set('page', String(page));
          
          const url = `${this.baseUrl}/list/sale/?${sp.toString()}`;
          console.log(`[rengotai] Fetching prop=${prop} page ${page}: ${url}`);
          const html = await fetchHtml(url);
          const results = this.parseSearchResults(html);
          console.log(`[rengotai] prop=${prop} Page ${page}: found ${results.length} listings`);
          if (results.length === 0) break;
          candidates.push(...results);
          await throttle(2000);
        } catch (e) {
          console.error(`[rengotai] Error at prop=${prop} page ${page}:`, e);
          break;
        }
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
    
    // 物件タイプを判定
    const propertyType = detectPropertyType(html) || '中古戸建て';
    const isKodate = propertyType.includes('戸建');
    const totalUnits = extractNumber(html, /総戸数[^<]*(\d+)/);
    const numRoomsFromLayout = extractNumber(html, /(\d+)[SLDK]+/);
    
    // 最寄駅と徒歩分数を取得
    const stationInfo = extractStationInfo(html);
    
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: extractPrice(html),
      address_raw: html.match(/北海道[^\s<]+/)?.[0] 
        || html.match(/札幌市[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
      built_year: extractBuiltYear(html),
      rooms: isKodate ? numRoomsFromLayout : totalUnits,
      units: isKodate ? 1 : (totalUnits || 1),
      num_rooms: isKodate ? numRoomsFromLayout : null,
      nearest_station: stationInfo.station,
      walk_minutes: stationInfo.walkMinutes,
      property_type: propertyType,
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
        units: detail.units, num_rooms: detail.num_rooms,
        nearest_station: detail.nearest_station,
        walk_minutes: detail.walk_minutes,
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
    const stationInfo = extractStationInfo(html);
    return {
      url,
      title: html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || '物件名不明',
      price: extractPrice(html),
      address_raw: html.match(/北海道[^\s<]+/)?.[0] || null,
      building_area: extractNumber(html, /建物面積[^<]*([\d.]+)\s*m/),
      land_area: extractNumber(html, /土地面積[^<]*([\d.]+)\s*m/),
      built_year: extractBuiltYear(html),
      rooms: extractNumber(html, /(\d+)[SLDK]+/) || 1,
      units: 1,  // 中古戸建ては常に1戸
      num_rooms: extractNumber(html, /(\d+)[SLDK]+/) || null,  // 間取りから部屋数
      nearest_station: stationInfo.station,
      walk_minutes: stationInfo.walkMinutes,
      property_type: '中古戸建て',
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
        units: detail.units, num_rooms: detail.num_rooms,
        nearest_station: detail.nearest_station,
        walk_minutes: detail.walk_minutes,
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
