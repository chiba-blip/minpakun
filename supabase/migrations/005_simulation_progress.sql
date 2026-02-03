-- シミュレーション進捗管理テーブル
CREATE TABLE IF NOT EXISTS simulation_progress (
  id TEXT PRIMARY KEY DEFAULT 'current',
  status TEXT NOT NULL DEFAULT 'idle', -- 'idle', 'in_progress', 'completed', 'cancelled', 'error'
  processed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 初期行を挿入
INSERT INTO simulation_progress (id, status, processed, total) 
VALUES ('current', 'idle', 0, 0)
ON CONFLICT (id) DO NOTHING;
