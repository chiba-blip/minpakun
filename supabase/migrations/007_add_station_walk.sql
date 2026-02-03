-- 最寄駅と徒歩分数を追加
ALTER TABLE properties ADD COLUMN IF NOT EXISTS nearest_station TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS walk_minutes INT;
