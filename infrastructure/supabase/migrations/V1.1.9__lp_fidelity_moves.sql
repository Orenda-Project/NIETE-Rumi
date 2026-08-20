-- LP Fidelity (FICO Section B) — the prescribed teaching-move lists (the fidelity DENOMINATOR).
-- One row per corpus LP VERSION, keyed identically to niete_lp_assets (lesson_id + version_stamp +
-- content_hash) so a coaching session resolves the moves for the exact LP the teacher downloaded — not
-- "latest". The per-session fidelity RESULT is stored separately in coaching_sessions.analysis_data.lp_fidelity
-- (jsonb sub-field, no migration). Uploaded (non-corpus) LP move-lists are per-session and are NOT stored here.
--
-- Anti-sprawl (root CLAUDE.md Rule 15): a dedicated table is used because the move-list is one row per LP
-- VERSION — a grain no existing table holds (niete_lp_assets is per asset_kind; niete_lp_downloads is
-- per download). It carries no data duplicated elsewhere.
-- Refs: bd-wmfsp.3 (P1.2). Idempotent.

CREATE TABLE IF NOT EXISTS niete_lp_fidelity_moves (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id      text NOT NULL,
  catalog_version text,
  version_stamp  text,
  content_hash   text,
  brief_sha      text,          -- the extraction brief that produced these moves (re-extract on change)
  template       text,          -- STANDARD | REVISION | UPLOADED
  total_minutes  integer,
  moves          jsonb NOT NULL, -- fidelity-moves-v1 array (the prescribed action list)
  n_moves        integer,
  model          text,          -- the projector model (e.g. gpt-5.6-luna / claude-haiku-4-5)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT niete_lp_fidelity_moves_version_uniq UNIQUE (lesson_id, version_stamp, content_hash)
);

-- Runtime lookup path: (lesson_id, version_stamp, content_hash). The UNIQUE constraint already backs it,
-- but an explicit index on lesson_id alone supports the current-version fallback query.
CREATE INDEX IF NOT EXISTS idx_niete_lp_fidelity_moves_lesson ON niete_lp_fidelity_moves (lesson_id);
