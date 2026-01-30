/**
 * テキスト正規化ユーティリティ
 */

/**
 * 全角→半角変換
 */
export function toHalfWidth(str: string): string {
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[\u3000]/g, ' ');
}

/**
 * 半角→全角変換（数字）
 */
export function toFullWidthNumber(str: string): string {
  return str.replace(/[0-9]/g, (s) => String.fromCharCode(s.charCodeAt(0) + 0xFEE0));
}

/**
 * 数値文字列から数値を抽出
 * "1,234万円" → 12340000
 * "1,234㎡" → 1234
 */
export function extractNumericValue(str: string, unit?: '万円' | '億円' | '㎡'): number | null {
  if (!str) return null;

  const normalized = toHalfWidth(str).replace(/,/g, '');
  const match = normalized.match(/([\d.]+)/);
  
  if (!match) return null;

  let value = parseFloat(match[1]);

  if (unit === '万円' || str.includes('万')) {
    value *= 10000;
  } else if (unit === '億円' || str.includes('億')) {
    value *= 100000000;
  }

  return value;
}

/**
 * HTMLタグを除去
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * 改行と連続スペースを整理
 */
export function normalizeWhitespace(str: string): string {
  return str
    .replace(/[\r\n]+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
