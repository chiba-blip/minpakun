import { NextRequest, NextResponse } from 'next/server';

/**
 * デバッグ用：スクレイピングテスト
 * 1つのサイトから実際にHTMLを取得して、パース結果を返す
 */
export async function GET(request: NextRequest) {
  const site = request.nextUrl.searchParams.get('site') || 'athome';
  
  const results: {
    site: string;
    url: string;
    status: string;
    htmlLength: number;
    htmlSample: string;
    foundLinks: string[];
    error?: string;
  } = {
    site,
    url: '',
    status: 'pending',
    htmlLength: 0,
    htmlSample: '',
    foundLinks: [],
  };

  try {
    // テスト用URL
    const testUrls: Record<string, string> = {
      athome: 'https://www.athome.co.jp/kodate/chuko/hokkaido/list/',
      homes: 'https://www.homes.co.jp/kodate/chuko/hokkaido/list/',
      suumo: 'https://suumo.jp/jj/bukken/ichiran/JJ010FJ001/?ar=010&bs=021&ta=01&sa=01',
      kenbiya: 'https://www.kenbiya.com/list/hokkaido/?dim=8',
      rakumachi: 'https://www.rakumachi.jp/syuuekibukken/area/prefecture/dimAll/?location_prefecture_id=1&dim[]=1004',
    };

    const url = testUrls[site] || testUrls.athome;
    results.url = url;

    console.log(`[test-scrape] Fetching ${url}`);

    // fetch実行
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      },
    });

    console.log(`[test-scrape] Response status: ${response.status}`);

    if (!response.ok) {
      results.status = `HTTP Error: ${response.status}`;
      results.error = response.statusText;
      return NextResponse.json(results);
    }

    const html = await response.text();
    results.htmlLength = html.length;
    results.htmlSample = html.substring(0, 2000);
    results.status = 'fetched';

    console.log(`[test-scrape] HTML length: ${html.length}`);

    // リンク抽出テスト
    const linkPatterns: Record<string, RegExp[]> = {
      athome: [
        /href="(https:\/\/www\.athome\.co\.jp\/kodate\/\d+\/[^"]*)"/gi,
        /href="(\/kodate\/\d+\/\?[^"]*)"/gi,
      ],
      homes: [
        /href="(https:\/\/www\.homes\.co\.jp\/kodate\/b-\d+[^"]*)"/gi,
        /href="(\/kodate\/b-\d+[^"]*)"/gi,
      ],
      suumo: [
        /href="(\/chukoikkodate\/__JJ_[^"]+)"/gi,
        /href="(\/chukoikkodate\/[^"]*nc_\d+[^"]*)"/gi,
      ],
      kenbiya: [
        /href="(\/property\/\d+[^"]*)"/gi,
      ],
      rakumachi: [
        /href="(\/syuuekibukken\/[^"]*\/\d+\/show\.html)"/gi,
      ],
    };

    const patterns = linkPatterns[site] || linkPatterns.athome;
    const links: string[] = [];
    
    for (const pattern of patterns) {
      for (const match of html.matchAll(pattern)) {
        if (!links.includes(match[1])) {
          links.push(match[1]);
        }
      }
    }

    results.foundLinks = links.slice(0, 20); // 最初の20件
    results.status = 'success';

    console.log(`[test-scrape] Found ${links.length} links`);

    return NextResponse.json(results);
  } catch (error) {
    results.status = 'error';
    results.error = String(error);
    console.error(`[test-scrape] Error:`, error);
    return NextResponse.json(results, { status: 500 });
  }
}
