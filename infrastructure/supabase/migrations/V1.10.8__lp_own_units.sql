-- V1.10.8 — "Make my own → A whole unit": niete_lp_own_units (bd-snkn32.59, queue #165).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. A teacher plans several days together: a chapter range of her book (or, later, 2-8 official goals), her
-- period length and a pace become a day-by-day outline she can move, join or split (lp-own-unit-outline.js,
-- lp-own-unit-edit.js). The outline exists BEFORE any day's plan is made, and most of its days never get one until
-- she opens them, so it cannot be a row of niete_lp612_own_plans (one row = one made plan, with its file, review
-- and rating; every reader of that table assumes so). Day plans stay rows there, with answers.unit = {unit_id,
-- day_no}. This table holds no plan body, no file and no AI output: only her choices and the day order.
-- ASKED FIRST (docs/lesson-plan-data-model-debt.md): a new lesson-plan-adjacent table; the operator's yes is
-- recorded on queue #165 before this is applied anywhere.
-- Period "saved for this class": read from her latest unit for that class + subject (no new column on classes).
-- DATA CLASSIFICATION (D6): '[Internal]' — user_id ties the row to a teacher; no free text, no phone, no name.
-- OWNER (D7): NIETE-Rumi platform (bd-snkn32.59).
-- DATA. New empty table. LOAD. One row per saved unit, one update per outline change; reads by (user_id) index.
-- SECURITY. Service role only (RLS on, no policies), like niete_lp612_own_plans. Soft delete: deleted_at (D9).
-- IDEMPOTENT. IF NOT EXISTS throughout. Rollback: ROLLBACK_V1.10.8__lp_own_units.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS niete_lp_own_units (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  class_id         UUID REFERENCES classes(id),
  book_stem        TEXT NOT NULL,
  grade            SMALLINT NOT NULL CHECK (grade BETWEEN 1 AND 12),
  subject          TEXT NOT NULL,
  start_kind       TEXT NOT NULL CHECK (start_kind IN ('book', 'goals')),
  chapter_from     SMALLINT,
  chapter_to       SMALLINT,
  goal_codes       TEXT[],
  period_minutes   SMALLINT NOT NULL CHECK (period_minutes BETWEEN 20 AND 90),
  pace             TEXT NOT NULL CHECK (pace IN ('recommended', 'slower', 'faster')),
  outline          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'archived')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT niete_lp_own_units_book_range CHECK (start_kind <> 'book' OR (chapter_from IS NOT NULL AND chapter_to >= chapter_from)),
  CONSTRAINT niete_lp_own_units_goals CHECK (start_kind <> 'goals' OR cardinality(goal_codes) BETWEEN 2 AND 8)
);

CREATE INDEX IF NOT EXISTS idx_lp_own_units_user
  ON niete_lp_own_units (user_id, updated_at DESC);

ALTER TABLE niete_lp_own_units ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE niete_lp_own_units IS
  'Make my own, a whole unit: a teacher''s day-by-day outline (book chapters or goals, period, pace). No plan bodies: each day''s plan is a niete_lp612_own_plans row with answers.unit.';

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT count(*) FROM niete_lp_own_units;  -- 0
