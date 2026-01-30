/**
 * 住所正規化ユーティリティ
 */

/**
 * 住所を正規化
 */
export function normalizeAddress(address: string): string {
  if (!address) return '';

  const normalized = address
    // 全角数字→半角
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    // 全角ハイフン類→半角
    .replace(/[ー−－―‐]/g, '-')
    // スペース正規化
    .replace(/[\s　]+/g, ' ')
    .trim()
    // 「丁目」「番地」「号」を統一形式に
    .replace(/(\d+)丁目/g, '$1-')
    .replace(/(\d+)番地?/g, '$1-')
    .replace(/(\d+)号/g, '$1')
    // 連続ハイフン削除
    .replace(/-+/g, '-')
    // 末尾ハイフン削除
    .replace(/-$/, '');

  return normalized;
}

/**
 * 市区町村を抽出
 */
export function extractCity(address: string): string | null {
  if (!address) return null;

  const patterns = [
    /北海道\s*(札幌市[^区]*区)/,
    /北海道\s*(小樽市)/,
    /北海道\s*余市郡\s*(余市町)/,
    /北海道\s*虻田郡\s*(ニセコ町)/,
    /北海道\s*虻田郡\s*(倶知安町)/,
    /(札幌市[^区]*区)/,
    /(小樽市)/,
    /(余市町)/,
    /(ニセコ町)/,
    /(倶知安町)/,
    /([^都道府県]+[市区町村])/,
  ];

  for (const pattern of patterns) {
    const match = address.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}
