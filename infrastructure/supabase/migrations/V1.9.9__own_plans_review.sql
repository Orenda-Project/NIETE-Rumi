-- V1.9.9 — "Make my own": the AI reviewer's verdict on a teacher's own plan (bd-snkn32.16).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. After her plan is ready, a cheaper model scores it against gate v2 (judge % >= 85, no check rated 1, key
-- checks 7B/5D >= 3). The verdict decides ONLY whether the plan may join the shared library, beside the standard
-- plans, tagged "Made by a teacher". She always has her plan: nothing here is read on her path.
-- The EXISTING own-plan table is widened (docs/lesson-plan-data-model-debt.md: no new LP table).
-- DATA CLASSIFICATION (D6): unchanged, '[Confidential]' (user_id + her note). The new columns are a model's ratings,
-- not PII. The library read (lp612-own-library) selects no user_id and no answers.
-- OWNER (D7): NIETE-Rumi platform (bd-snkn32.16).
-- DATA. Existing rows: all review columns NULL, library_eligible false (never reviewed = not in the library).
-- LOAD. One UPDATE per ready plan. SECURITY. Unchanged (RLS on, service role only).
-- IDEMPOTENT. IF NOT EXISTS / DROP CONSTRAINT IF EXISTS. Rollback: ROLLBACK_V1.9.9__own_plans_review.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS review_score NUMERIC(4,1);
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS review_pass BOOLEAN;
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS review_items JSONB;
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS review_model TEXT;
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS library_eligible BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_review_score_range;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_review_score_range
  CHECK (review_score IS NULL OR (review_score >= 0 AND review_score <= 100));
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_library_needs_pass;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_library_needs_pass
  CHECK (NOT library_eligible OR review_pass IS TRUE);

CREATE INDEX IF NOT EXISTS idx_lp612_own_plans_library
  ON niete_lp612_own_plans (reviewed_at DESC) WHERE library_eligible;

COMMENT ON COLUMN niete_lp612_own_plans.review_score IS 'AI reviewer judge % (0-100) under gate v2; NULL = not reviewed or the reviewer failed.';
COMMENT ON COLUMN niete_lp612_own_plans.review_pass IS 'Gate v2 verdict: judge >= 85, no check rated 1, key checks 7B/5D >= 3.';
COMMENT ON COLUMN niete_lp612_own_plans.review_items IS 'Per-check ratings {check_id: 1-4 | null} from the reviewer.';
COMMENT ON COLUMN niete_lp612_own_plans.review_model IS 'Model that scored the plan.';
COMMENT ON COLUMN niete_lp612_own_plans.reviewed_at IS 'When the reviewer scored the plan.';
COMMENT ON COLUMN niete_lp612_own_plans.library_eligible IS 'May be listed in the shared library (tagged Made by a teacher). Never gates her own plan.';

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT count(*) FROM niete_lp612_own_plans WHERE library_eligible;  -- 0
