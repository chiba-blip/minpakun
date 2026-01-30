/**
 * HTTPリクエストユーティリティ
 * スクレイピング時のレート制御とエラーハンドリング
 */

export interface FetchOptions {
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
};

/**
 * リトライ付きfetch
 */
export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const {
    headers = {},
    timeout = 30000,
    retries = 3,
    retryDelay = 1000,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, ...headers },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < retries) {
        // 指数バックオフ
        const delay = retryDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Fetch failed');
}

/**
 * HTMLをfetchしてテキストとして取得
 */
export async function fetchHtml(url: string, options?: FetchOptions): Promise<string> {
  const response = await fetchWithRetry(url, options);
  return response.text();
}

/**
 * スリープ関数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * レート制限用のスロットリング
 */
export async function throttle(minIntervalMs: number = 1000): Promise<void> {
  await sleep(minIntervalMs);
}
