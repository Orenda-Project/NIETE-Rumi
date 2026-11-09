-- V1.9.6 — "Make my own" lesson plans: niete_lp612_own_plans (bd-snkn32).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. A teacher answers five questions about her class (size, what she has, her class against the book, a teaching
-- way, an optional note) and gets the chapter's 6-12 plan rewritten for her room. That rewrite is a FORK of the shared
-- render: the shared row in niete_lp612_renders has no user dimension and is never touched. Her fork's PDF lives under
-- lp612/{tv}/{lang}/edits/{segment}/{hash}.pdf (lp612-serving editKeyFor); this table says which teacher holds it.
--
-- DATA CLASSIFICATION (D6): '[Confidential]' — user_id ties the row to a teacher, and `answers.note` is her free text
-- (bounded to 200 chars by lp612-own-instruction). No phone, no name, no school. Never exported to a shared pool from
-- here: the pool (a later phase) copies a plan with the user removed.
-- OWNER (D7): NIETE-Rumi platform (bd-snkn32).
-- DATA. New empty table. LOAD. One row per Make my plan tap. SECURITY. Service role only (RLS on, no policies), like
-- the 6-12 render table's server-only use.
-- IDEMPOTENT. IF NOT EXISTS throughout.
-- Rollback: ROLLBACK_V1.9.6__lp612_own_plans.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS niete_lp612_own_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  segment_id        TEXT NOT NULL REFERENCES niete_lp612_segments(segment_id),
  lang              TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'ur')),
  template_version  TEXT NOT NULL,
  answers           JSONB NOT NULL,
  edit_hash         TEXT,
  status            TEXT NOT NULL DEFAULT 'authoring' CHECK (status IN ('authoring', 'ready', 'failed')),
  r2_key            TEXT CHECK (r2_key IS NULL OR r2_key LIKE 'lp612/%'),
  model_used        TEXT,
  error_code        TEXT,
  error_detail      TEXT,
  correlation_id    TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lp612_own_plans_user
  ON niete_lp612_own_plans (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lp612_own_plans_inflight
  ON niete_lp612_own_plans (status, started_at) WHERE status = 'authoring';

ALTER TABLE niete_lp612_own_plans ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE niete_lp612_own_plans IS
  'Make my own: a teacher''s fork of a 6-12 lesson plan, rewritten from her class answers. One row per request. r2_key is always under lp612/ (the edits/ path). Never written into niete_lp612_renders.';

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT count(*) FROM niete_lp612_own_plans;  -- 0
