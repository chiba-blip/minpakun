-- 戸数と部屋数を分離
-- units: 戸数（中古戸建=1固定、集合住宅=戸数）
-- num_rooms: 部屋数（中古戸建=部屋数、集合住宅=NULL）

-- 新しいカラムを追加
ALTER TABLE properties ADD COLUMN IF NOT EXISTS units INT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS num_rooms INT;

-- 既存データの移行：roomsの値をunitsにコピー
UPDATE properties SET units = rooms WHERE units IS NULL AND rooms IS NOT NULL;

-- 中古戸建ての場合、unitsを1に設定
UPDATE properties SET units = 1 WHERE property_type = '中古戸建て' OR property_type LIKE '%戸建%';
