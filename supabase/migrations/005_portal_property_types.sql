-- ポータルサイトごとの物件タイプ設定
ALTER TABLE portal_sites ADD COLUMN IF NOT EXISTS property_types TEXT[] DEFAULT '{}';
