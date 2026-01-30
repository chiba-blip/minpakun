-- 追加のポータルサイトを登録

INSERT INTO portal_sites (name, key, enabled, base_url) VALUES
  ('SUUMO', 'suumo', true, 'https://suumo.jp'),
  ('アットホーム', 'athome', true, 'https://www.athome.co.jp'),
  ('LIFULL HOME''S', 'homes', true, 'https://www.homes.co.jp'),
  ('北海道不動産連合隊', 'hokkaido-rengotai', true, 'https://www.rengotai.com'),
  ('ハウスドゥ', 'housedo', true, 'https://www.housedo.co.jp')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  base_url = EXCLUDED.base_url;
