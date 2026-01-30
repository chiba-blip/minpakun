-- みんぱくん（Minpakun）初期スキーマ
-- Supabase Postgres Migration

-- ========================================
-- 1. portal_sites（対象サイトの追加/削除/ON/OFF）
-- ========================================
CREATE TABLE portal_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  base_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初期データ
INSERT INTO portal_sites (name, key, base_url, enabled) VALUES
  ('健美家', 'kenbiya', 'https://www.kenbiya.com/', true),
  ('楽待', 'rakumachi', 'https://www.rakumachi.com/', true),
  ('SUUMO', 'suumo', 'https://suumo.jp/', false),
  ('アットホーム', 'athome', 'https://www.athome.co.jp/', false),
  ('ホームズ', 'homes', 'https://www.homes.co.jp/', false),
  ('北海道不動産連合隊', 'hokkaido-rengotai', 'https://www.rengotai.com/', false),
  ('ハウスドゥ', 'housedo', 'https://www.housedo.co.jp/', false);

-- ========================================
-- 2. scrape_configs（スクレイプ条件）
-- ========================================
CREATE TABLE scrape_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN DEFAULT TRUE,
  areas TEXT[] DEFAULT ARRAY['札幌市','小樽市','余市町','ニセコ町','倶知安町'],
  property_types TEXT[] DEFAULT ARRAY['中古戸建て','一棟集合住宅'],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初期設定
INSERT INTO scrape_configs (enabled, areas, property_types) VALUES
  (true, ARRAY['札幌市','小樽市','余市町','ニセコ町','倶知安町'], ARRAY['中古戸建て','一棟集合住宅']);

-- ========================================
-- 3. properties（物件統合マスター）
-- ========================================
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_address TEXT,
  city TEXT,
  address_raw TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  building_area DOUBLE PRECISION,
  land_area DOUBLE PRECISION,
  built_year INT,
  rooms INT,  -- 戸建て=1、集合=戸数
  property_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_properties_city ON properties(city);
CREATE INDEX idx_properties_normalized_address ON properties(normalized_address);
CREATE INDEX idx_properties_created_at ON properties(created_at DESC);

-- ========================================
-- 4. listings（サイト掲載情報）
-- ========================================
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_site_id UUID NOT NULL REFERENCES portal_sites(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  title TEXT,
  price BIGINT,
  external_id TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  raw JSONB,
  UNIQUE(portal_site_id, external_id),
  UNIQUE(portal_site_id, url)
);

-- インデックス
CREATE INDEX idx_listings_property_id ON listings(property_id);
CREATE INDEX idx_listings_scraped_at ON listings(scraped_at DESC);
CREATE INDEX idx_listings_price ON listings(price);

-- ========================================
-- 5. simulations（3シナリオ）
-- ========================================
CREATE TABLE simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  scenario TEXT NOT NULL CHECK (scenario IN ('NEGATIVE', 'NEUTRAL', 'POSITIVE')),
  annual_revenue BIGINT,
  annual_profit BIGINT,
  assumptions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(property_id, scenario, listing_id)
);

-- インデックス
CREATE INDEX idx_simulations_property_id ON simulations(property_id);
CREATE INDEX idx_simulations_scenario ON simulations(scenario);

-- ========================================
-- 6. simulation_monthlies（12ヶ月）
-- ========================================
CREATE TABLE simulation_monthlies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  month INT NOT NULL CHECK (month >= 1 AND month <= 12),
  nightly_rate INT,
  occupancy_rate NUMERIC(5,2),
  booked_nights INT,
  reservations INT,
  avg_stay NUMERIC(5,2),
  revenue INT,
  UNIQUE(simulation_id, month)
);

-- インデックス
CREATE INDEX idx_simulation_monthlies_simulation_id ON simulation_monthlies(simulation_id);

-- ========================================
-- 7. cost_configs（コスト前提：変更可能）
-- ========================================
CREATE TABLE cost_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_fee_per_reservation INT DEFAULT 10000,
  ota_fee_rate NUMERIC(5,2) DEFAULT 15.00,
  management_fee_rate NUMERIC(5,2) DEFAULT 20.00,
  other_cost_rate NUMERIC(5,2) DEFAULT 5.00,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初期設定
INSERT INTO cost_configs (cleaning_fee_per_reservation, ota_fee_rate, management_fee_rate, other_cost_rate) VALUES
  (10000, 15.00, 20.00, 5.00);

-- ========================================
-- 8. saved_searches（保存検索）
-- ========================================
CREATE TABLE saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  multiple NUMERIC(5,2) DEFAULT 7.00,  -- X倍率
  areas TEXT[],  -- nullならscrape_configsのareas
  property_types TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- 9. slack_configs（Slack通知設定）
-- ========================================
CREATE TABLE slack_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN DEFAULT TRUE,
  webhook_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- 10. notification_logs（二重通知防止）
-- ========================================
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_search_id UUID NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(saved_search_id, listing_id)
);

-- インデックス
CREATE INDEX idx_notification_logs_sent_at ON notification_logs(sent_at DESC);

-- ========================================
-- トリガー: updated_at自動更新
-- ========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

CREATE TRIGGER update_scrape_configs_updated_at
  BEFORE UPDATE ON scrape_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cost_configs_updated_at
  BEFORE UPDATE ON cost_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_saved_searches_updated_at
  BEFORE UPDATE ON saved_searches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- RLS（Row Level Security）
-- MVP: 管理者のみ前提でシンプルに
-- ========================================
ALTER TABLE portal_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_monthlies ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

-- authenticated用のポリシー（全テーブル共通）
CREATE POLICY "authenticated_all" ON portal_sites FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON scrape_configs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON properties FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON listings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON simulations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON simulation_monthlies FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON cost_configs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON saved_searches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON slack_configs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON notification_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- service_role用（Netlify Functions）は自動的にフルアクセス
