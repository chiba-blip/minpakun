-- AirROI APIレスポンスキャッシュテーブル
-- 同じlisting_idのメトリクスを重複して取得しないためのキャッシュ

CREATE TABLE IF NOT EXISTS airroi_listings_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id INTEGER NOT NULL UNIQUE, -- AirROIのlisting_id
  listing_name TEXT,
  bedrooms INTEGER,
  guests INTEGER,
  baths INTEGER,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  ttm_revenue INTEGER, -- 直近12ヶ月の売上
  ttm_avg_rate INTEGER, -- 直近12ヶ月の平均単価
  ttm_occupancy DOUBLE PRECISION, -- 直近12ヶ月の稼働率
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS airroi_metrics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id INTEGER NOT NULL, -- AirROIのlisting_id
  month_date TEXT NOT NULL, -- "2024-01" 形式
  revenue INTEGER,
  occupancy DOUBLE PRECISION, -- 0-1
  average_daily_rate INTEGER,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(listing_id, month_date)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_airroi_listings_cache_listing_id ON airroi_listings_cache(listing_id);
CREATE INDEX IF NOT EXISTS idx_airroi_metrics_cache_listing_id ON airroi_metrics_cache(listing_id);
CREATE INDEX IF NOT EXISTS idx_airroi_metrics_cache_cached_at ON airroi_metrics_cache(cached_at);
