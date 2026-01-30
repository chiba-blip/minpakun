/**
 * 住所正規化ユーティリティ
 * 表記揺れを吸収してマッチングしやすくする
 */

/**
 * 住所を正規化
 * - 全角数字→半角
 * - 不要なスペース削除
 * - 「丁目」「番地」「号」の統一
 */
export function normalizeAddress(address: string): string {
  if (!address) return '';

  let normalized = address
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

  // 北海道の市町村パターン
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
    // 汎用パターン
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

/**
 * 都道府県を抽出
 */
export function extractPrefecture(address: string): string | null {
  const match = address.match(/(北海道|東京都|大阪府|京都府|[^都道府県]+県)/);
  return match ? match[1] : null;
}

/**
 * 住所の類似度を計算（0-1）
 * 重複検知用
 */
export function addressSimilarity(addr1: string, addr2: string): number {
  const n1 = normalizeAddress(addr1);
  const n2 = normalizeAddress(addr2);

  if (n1 === n2) return 1;

  // レーベンシュタイン距離の簡易版
  const longer = n1.length > n2.length ? n1 : n2;
  const shorter = n1.length > n2.length ? n2 : n1;

  if (longer.length === 0) return 1;

  // 短い方が長い方に含まれるか
  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }

  // 共通部分の長さで判定
  let commonLength = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter.substring(0, shorter.length - i))) {
      commonLength = shorter.length - i;
      break;
    }
  }

  return commonLength / longer.length;
}
