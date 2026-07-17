ALTER TABLE cf_clip_candidates ADD COLUMN selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_cf_clip_candidates_selected
  ON cf_clip_candidates(project_name, selected, score DESC);
