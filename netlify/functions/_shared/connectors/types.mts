/**
 * スクレイピングConnector共通型定義
 */

/**
 * 検索パラメータ
 */
export interface SearchParams {
  areas: string[];
  propertyTypes: string[];
  maxPages?: number;
}

/**
 * 検索結果の候補（一覧から取得）
 */
export interface ListingCandidate {
  url: string;
  title?: string;
  price?: number;
  locationText?: string;
}

/**
 * 詳細ページから取得した情報
 */
export interface ListingDetail {
  url: string;
  title: string;
  price: number | null;
  address_raw: string | null;
  building_area: number | null;
  land_area: number | null;
  built_year: number | null;
  rooms: number | null;
  property_type: string | null;
  nearest_station?: string | null;  // 交通情報（最寄駅・バス停など）
  walk_minutes?: number | null;     // 徒歩分数
  images?: string[];
  description?: string;
  external_id?: string;
  raw: Record<string, unknown>;
}

/**
 * DB保存用の正規化済みリスティング
 */
export interface NormalizedListing {
  url: string;
  title: string;
  price: number | null;
  external_id: string | null;
  raw: Record<string, unknown>;
  property: {
    address_raw: string | null;
    normalized_address: string | null;
    city: string | null;
    building_area: number | null;
    land_area: number | null;
    built_year: number | null;
    rooms: number | null;
    property_type: string | null;
    nearest_station?: string | null;  // 交通情報
    walk_minutes?: number | null;     // 徒歩分数
  };
}

/**
 * Connectorインターフェイス
 */
export interface Connector {
  /** サイトキー（portal_sites.key） */
  readonly key: string;
  
  /** サイト名 */
  readonly name: string;

  /**
   * 検索を実行し、候補URLリストを取得
   */
  search(params: SearchParams): Promise<ListingCandidate[]>;

  /**
   * 詳細ページから情報を取得
   */
  fetchDetail(url: string): Promise<ListingDetail>;

  /**
   * 取得した詳細を正規化
   */
  normalize(detail: ListingDetail): NormalizedListing;
}

/**
 * エリアマッピング（サイトごとに変換が必要な場合）
 */
export interface AreaMapping {
  [key: string]: {
    code?: string;
    param?: string;
    name: string;
  };
}

/**
 * 物件タイプマッピング
 */
export interface PropertyTypeMapping {
  [key: string]: {
    code?: string;
    param?: string;
    name: string;
  };
}
