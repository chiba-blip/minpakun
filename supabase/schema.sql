-- 物件マスター
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  address_text TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  capacity INT NOT NULL,
  layout_text TEXT NOT NULL,
  bedrooms INT,
  bathrooms NUMERIC,
  description TEXT,
  notes TEXT
);

-- 物件ごとの費用パラメータ
CREATE TABLE cost_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ota_fee_rate NUMERIC NOT NULL DEFAULT 0.15,
  cleaning_cost_per_turnover INT NOT NULL DEFAULT 12000,
  linen_cost_per_turnover INT NOT NULL DEFAULT 2500,
  consumables_cost_per_night INT DEFAULT 0,
  utilities_cost_per_month INT DEFAULT 0,
  management_fee_rate NUMERIC DEFAULT 0,
  avg_stay_nights NUMERIC NOT NULL DEFAULT 2.0,
  other_fixed_cost_per_month INT DEFAULT 0,
  tax_rate NUMERIC DEFAULT 0,
  UNIQUE(property_id)
);

-- 試算結果
CREATE TABLE estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  geocode_result JSONB,
  nearest_station JSONB,
  airdna_request JSONB,
  airdna_response JSONB,
  computed JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT
);

-- インデックス
CREATE INDEX idx_properties_created_at ON properties(created_at DESC);
CREATE INDEX idx_estimates_property_id ON estimates(property_id);
CREATE INDEX idx_estimates_created_at ON estimates(created_at DESC);

-- updated_atを自動更新するトリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

