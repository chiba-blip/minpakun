-- スクレイプ進捗管理テーブル
-- 各サイト・エリアごとの進捗を管理

CREATE TABLE scrape_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_key TEXT NOT NULL,                    -- 'athome', 'suumo' など
  area_key TEXT NOT NULL,                    -- 'otaru-city', 'sapporo-city' など
  area_name TEXT NOT NULL,                   -- '小樽市', '札幌市' など
  current_page INT DEFAULT 1,                -- 現在処理中のページ
  total_pages INT,                           -- 総ページ数（推定、nullは未確定）
  processed_count INT DEFAULT 0,             -- 処理済み件数
  inserted_count INT DEFAULT 0,              -- 新規登録件数
  skipped_count INT DEFAULT 0,               -- スキップ件数（既存）
  consecutive_skips INT DEFAULT 0,           -- 連続スキップ数（差分モード用）
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'error')),
  mode TEXT DEFAULT 'initial' CHECK (mode IN ('initial', 'incremental')),  -- 初回 or 差分
  error_message TEXT,                        -- エラーメッセージ
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_key, area_key)
);

-- インデックス
CREATE INDEX idx_scrape_progress_site_key ON scrape_progress(site_key);
CREATE INDEX idx_scrape_progress_status ON scrape_progress(status);

-- updated_atを自動更新するトリガー
CREATE OR REPLACE FUNCTION update_scrape_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_scrape_progress_updated_at
  BEFORE UPDATE ON scrape_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_scrape_progress_updated_at();
