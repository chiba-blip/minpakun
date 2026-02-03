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

// エリアコードマッピング
const RENGOTAI_AREA_CODES: { [key: string]: string } = {
  // 札幌市
  '札幌市': '1101,1102,1103,1104,1105,1106,1107,1108,1109,1110',
  '札幌市中央区': '1101',
  '札幌市北区': '1102',
  '札幌市東区': '1103',
  '札幌市白石区': '1104',
  '札幌市厚別区': '1105',
  '札幌市豊平区': '1106',
  '札幌市清田区': '1107',
  '札幌市南区': '1108',
  '札幌市西区': '1109',
  '札幌市手稲区': '1110',
  // 主要都市
  '函館市': '1202',
  '小樽市': '1203',
  '旭川市': '1204',
  '室蘭市': '1205',
  '釧路市': '1206',
  '帯広市': '1207',
  '北見市': '1208',
  '夕張市': '1209',
  '岩見沢市': '1210',
  '網走市': '1211',
  '留萌市': '1212',
  '苫小牧市': '1213',
  '稚内市': '1214',
  '美唄市': '1215',
  '芦別市': '1216',
  '江別市': '1217',
  '赤平市': '1218',
  '紋別市': '1219',
  '士別市': '1220',
  '名寄市': '1221',
  '三笠市': '1222',
  '根室市': '1223',
  '千歳市': '1224',
  '滝川市': '1225',
  '砂川市': '1226',
  '歌志内市': '1227',
  '深川市': '1228',
  '富良野市': '1229',
  '登別市': '1230',
  '恵庭市': '1231',
  '伊達市': '1233',
  '北広島市': '1234',
  '石狩市': '1235',
  '北斗市': '1236',
  // 後志地方（ニセコ・倶知安エリア）
  '余市町': '1408',
  '倶知安町': '1400',
  'ニセコ町': '1395',
  '仁木町': '1399',
  '赤井川村': '1409',
  '古平町': '1406',
  '積丹町': '1405',
  '神恵内村': '1404',
  '泊村': '1403',
  '共和町': '1402',
  '岩内町': '1401',
  '蘭越町': '1397',
  '真狩村': '1394',
  '留寿都村': '1393',
  '喜茂別町': '1396',
  '京極町': '1398',
  '黒松内町': '1391',
  '寿都町': '1392',
  '島牧村': '1390',
};

// 物件タイプコードマッピング
const RENGOTAI_DIV_CODES: { [key: string]: string } = {
  '一戸建て': '24',
  'マンション': '23',
  '土地': '26',
};

export class HokkaidoRengotaiConnector implements Connector {
  readonly key = 'hokkaido-rengotai';
  readonly name = '北海道不動産連合隊';

  private listBaseUrl = 'https://fudosanlist.cbiz.ne.jp';
  private detailBaseUrl = 'https://fudosan.cbiz.ne.jp';

  /**
   * 検索URLを構築
   */
  private buildSearchUrl(areaCode: string, divCode: string, page: number = 1): string {
    // 連合隊の検索URL構造
    // https://fudosanlist.cbiz.ne.jp/list/sale/?area=hokkaido&prop=1&nstg=2&div=24&a2=1203
    const params = new URLSearchParams({
      area: 'hokkaido',
      prop: '1',  // 売買物件
      nstg: '2',  // ステータス
      div: divCode,
      a2: areaCode,
      page: String(page),
      lim: '50',  // 1ページ50件
    });
    
    return `${this.listBaseUrl}/list/sale/?${params.toString()}`;
  }

  /**
   * 検索を実行し、候補リストを取得
   */
  async search(params: SearchParams): Promise<ListingCandidate[]> {
    const candidates: ListingCandidate[] = [];
    const maxPages = params.maxPages || 10;

    logInfo(`[${this.key}] Starting search`, { 
      areas: params.areas, 
      types: params.propertyTypes 
    });

    const propertyTypes = params.propertyTypes.length > 0 
      ? params.propertyTypes 
      : ['一戸建て'];

    // エリアごと、物件タイプごとに検索
    for (const areaName of params.areas) {
      const areaCode = RENGOTAI_AREA_CODES[areaName];
      if (!areaCode) {
        logInfo(`[${this.key}] No area code for: ${areaName}`);
        continue;
      }

      for (const propType of propertyTypes) {
        const divCode = RENGOTAI_DIV_CODES[propType] || '24';

        for (let page = 1; page <= maxPages; page++) {
          try {
            const url = this.buildSearchUrl(areaCode, divCode, page);
            logInfo(`[${this.key}] Fetching ${areaName} ${propType} page ${page}`, { url });

            const html = await fetchHtml(url);
            const pageResults = this.parseSearchResults(html);

            logInfo(`[${this.key}] Found ${pageResults.length} candidates on page ${page}`);

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
    // https://fudosan.cbiz.ne.jp/detailPage/sale/1266/545/?prop=1&area=hokkaido&fr=l
    const propertyPattern = /href="(https:\/\/fudosan\.cbiz\.ne\.jp\/detailPage\/sale\/[^"]+)"/gi;
    const matches = html.matchAll(propertyPattern);

    for (const match of matches) {
      let fullUrl = match[1];
      // クエリパラメータを除去
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
    const transportInfo = this.extractTransport(html);
    
    logInfo(`[${this.key}] Transport info extracted`, { 
      nearest_station: transportInfo.text, 
      walk_minutes: transportInfo.walkMinutes 
    });
    
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
      nearest_station: transportInfo.text,
      walk_minutes: transportInfo.walkMinutes,
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
        nearest_station: detail.nearest_station,
        walk_minutes: detail.walk_minutes,
      },
    };
  }

  private extractTitle(html: string): string {
    const patterns = [
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title>売買物件詳細\s*\(([^)]+)\)/i,
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
    // 億円パターン
    const okuPattern = /<div class="price01">(\d+)<span class="unit">億<\/span>/i;
    const okuMatch = html.match(okuPattern);
    if (okuMatch) {
      return parseInt(okuMatch[1], 10) * 100000000;
    }

    // 万円パターン
    const patterns = [
      /<div class="price01">([\d,]+)<span class="unit">万<\/span>/i,
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
    // 連合隊詳細ページのパターン
    // 1. <a class="icoMarker">北海道小樽市祝津3-100</a>
    const icoMarkerMatch = html.match(/<a[^>]*class="icoMarker"[^>]*>([^<]+)<\/a>/i);
    if (icoMarkerMatch && icoMarkerMatch[1]) {
      const address = icoMarkerMatch[1].trim();
      if (address.includes('北海道') || address.match(/[市町村区]/)) {
        return address;
      }
    }

    // 2. "ADDRESS":"..." in JavaScript (Unicode escaped)
    const jsonMatch = html.match(/"ADDRESS":"([^"]+)"/);
    if (jsonMatch && jsonMatch[1]) {
      const address = jsonMatch[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => 
        String.fromCharCode(parseInt(code, 16))
      );
      if (address.length > 5) {
        return address;
      }
    }

    // 3. タイトルから住所を抽出 (小樽市祝津3丁目100番)
    const titleMatch = html.match(/<title>売買物件詳細\s*\(([^)]+)\)/i);
    if (titleMatch && titleMatch[1]) {
      const titleParts = titleMatch[1].split(/\s+/);
      if (titleParts[0] && titleParts[0].match(/[市町村区]/)) {
        return '北海道' + titleParts[0];
      }
    }

    // 4. h1タグから住所部分を抽出
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match && h1Match[1]) {
      const h1Text = h1Match[1].trim();
      // 「小樽市〇〇」のような形式を探す
      const cityMatch = h1Text.match(/([^\s]+[市町村区][^\s]*)/);
      if (cityMatch) {
        return '北海道' + cityMatch[1];
      }
    }

    return null;
  }

  private extractBuildingArea(html: string): number | null {
    const patterns = [
      /<th>建物面積<\/th>[\s\S]*?<td[^>]*>([\d.]+)m/i,
      /建物面積[：:\s]*([\d.]+)\s*[㎡m²]/,
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
    const patterns = [
      /<th>土地面積<\/th>[\s\S]*?<td[^>]*>[\s\S]*?([\d.]+)m/i,
      /土地面積[：:\s]*([\d.]+)\s*[㎡m²]/,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return parseFloat(match[1]);
      }
    }
    return null;
  }

  private extractBuiltYear(html: string): number | null {
    const patterns = [
      /築(\d+)年.*?\((\d{4})年/i,
      /(\d{4})年\d+月.*?築/,
      /築年月<\/th>[\s\S]*?(\d{4})年/i,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        // 築N年パターンの場合は2番目のキャプチャ（年）を使用
        const year = match[2] || match[1];
        return parseInt(year, 10);
      }
    }
    return null;
  }

  private extractRooms(html: string): number | null {
    const patterns = [
      /<span class="room_layout">(\d+)[SLDK]+<\/span>/i,
      /間取り[：:\s]*(\d+)[SLDK]+/i,
      /(\d+)[SLDK]+/i,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return 1;
  }

  private extractPropertyType(html: string, url: string): string | null {
    const divPattern = /<span class="prop_div">([^<]+)<\/span>/i;
    const divMatch = html.match(divPattern);
    if (divMatch) {
      const divText = divMatch[1];
      if (divText.includes('マンション')) return 'マンション';
      if (divText.includes('一戸建')) return '一戸建て';
      if (divText.includes('土地')) return '土地';
    }
    return '一戸建て';
  }

  /**
   * 交通情報を抽出
   */
  private extractTransport(html: string): { text: string | null; walkMinutes: number | null } {
    // パターン1: st_nameクラスから取得
    const stationMatch = html.match(/<span class="st_name">([^<]+)<\/span>/i);
    const distanceMatch = html.match(/徒歩(\d+)分/i);
    
    logInfo(`[extractTransport] stationMatch: ${stationMatch ? stationMatch[1] : 'null'}, distanceMatch: ${distanceMatch ? distanceMatch[1] : 'null'}`);
    
    if (stationMatch) {
      const stationName = stationMatch[1].trim();
      const walkMinutes = distanceMatch ? parseInt(distanceMatch[1], 10) : null;
      const transportText = walkMinutes !== null ? `${stationName} 徒歩${walkMinutes}分` : stationName;
      logInfo(`[extractTransport] Found: ${transportText}`);
      return { text: transportText, walkMinutes };
    }
    
    // パターン2: rd_list_station内のテキストを取得
    const listMatch = html.match(/<ul class="rd_list_station">([\s\S]*?)<\/ul>/i);
    if (listMatch) {
      // タグを除去してテキストのみ抽出
      const text = listMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      logInfo(`[extractTransport] List pattern found: ${text}`);
      if (text) {
        const walkMatch = text.match(/徒歩(\d+)分/);
        return { text, walkMinutes: walkMatch ? parseInt(walkMatch[1], 10) : null };
      }
    }
    
    // パターン3: 交通セクション全体からテキスト抽出
    const sectionMatch = html.match(/id="stArea">交通<\/h2>([\s\S]*?)(?:<h2|<\/section)/i);
    if (sectionMatch) {
      const text = sectionMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      logInfo(`[extractTransport] Section pattern found: ${text}`);
      if (text) {
        const walkMatch = text.match(/徒歩(\d+)分/);
        return { text, walkMinutes: walkMatch ? parseInt(walkMatch[1], 10) : null };
      }
    }
    
    logInfo(`[extractTransport] No transport info found`);
    return { text: null, walkMinutes: null };
  }

  private extractExternalId(url: string): string | null {
    // https://fudosan.cbiz.ne.jp/detailPage/sale/1266/545/
    const match = url.match(/\/sale\/(\d+)\/(\d+)/);
    return match ? `${match[1]}-${match[2]}` : null;
  }
}
