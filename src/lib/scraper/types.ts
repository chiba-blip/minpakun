/**
 * スクレイピングConnector共通型定義
 */

export interface SearchParams {
  areas: string[];
  propertyTypes: string[];
  maxPages?: number;
}

export interface ListingCandidate {
  url: string;
  title?: string;
  price?: number;
  locationText?: string;
}

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
  images?: string[];
  description?: string;
  external_id: string | null;
  raw: Record<string, unknown>;
}

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
  };
}

export interface Connector {
  readonly key: string;
  readonly name: string;
  search(params: SearchParams): Promise<ListingCandidate[]>;
  fetchDetail(url: string): Promise<ListingDetail>;
  normalize(detail: ListingDetail): NormalizedListing;
}
