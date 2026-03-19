-- D1 Schema: เก็บเฉพาะยาที่ AI เรียนรู้ใหม่ (ไม่ซ้ำ hardcoded)
CREATE TABLE IF NOT EXISTS learned_drugs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generic_name TEXT NOT NULL UNIQUE,
  match_pattern TEXT NOT NULL,
  dose_pattern TEXT DEFAULT '(\d+)\s*mg',
  category TEXT DEFAULT 'unknown',
  route TEXT DEFAULT 'oral',
  sig_template TEXT DEFAULT '',
  timing TEXT DEFAULT '["morning"]',
  source TEXT DEFAULT 'ai',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_learned_name ON learned_drugs(generic_name);
