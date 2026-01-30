-- 保存検索テーブルの拡張
-- 追加の検索条件とコスト設定を含める

-- 検索条件の追加
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS price_min BIGINT;
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS price_max BIGINT;
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS walk_minutes_max INT;
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS built_year_min INT;
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS building_area_min DOUBLE PRECISION;
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS building_area_max DOUBLE PRECISION;

-- コスト設定の追加（検索ごとに異なるコスト前提を使いたい場合）
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS cleaning_fee_per_reservation INT DEFAULT 10000;
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS ota_fee_rate NUMERIC(5,2) DEFAULT 15.00;
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS management_fee_rate NUMERIC(5,2) DEFAULT 20.00;
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS other_cost_rate NUMERIC(5,2) DEFAULT 5.00;
