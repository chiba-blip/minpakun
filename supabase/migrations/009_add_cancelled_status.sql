-- スクレイプ進捗に'cancelled'ステータスを追加

-- 既存のチェック制約を削除
ALTER TABLE scrape_progress DROP CONSTRAINT IF EXISTS scrape_progress_status_check;

-- 新しいチェック制約を追加（cancelledを含む）
ALTER TABLE scrape_progress ADD CONSTRAINT scrape_progress_status_check 
  CHECK (status IN ('pending', 'in_progress', 'completed', 'error', 'cancelled'));
