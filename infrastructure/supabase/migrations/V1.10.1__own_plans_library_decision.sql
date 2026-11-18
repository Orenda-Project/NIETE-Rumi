-- V1.10.1 — "Make my own": a person's decision before an own plan is listed (bd-snkn32.42).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. The AI reviewer (V1.9.9) decides only whether a plan MAY be listed. Before any teacher sees another teacher's
-- plan on the "Made by a teacher" shelf, a person approves it: a plan is listed only when library_eligible (the AI
-- passed it) AND library_decision = 'approved'. The reviewers are staff named on app_settings portal_lp_own_reviewers.
-- The EXISTING own-plan table is widened (docs/lesson-plan-data-model-debt.md: no new LP table).
-- DATA CLASSIFICATION (D6): unchanged, '[Confidential]'. The new columns are a reviewer's id, a time and a reason;
-- the shelf read (lp612-own-library) selects none of them, no user_id and no answers.
-- OWNER (D7): NIETE-Rumi platform.
-- DATA. Existing rows: all NULL (undecided = not listed). LOAD. One UPDATE per decision. SECURITY. Unchanged (RLS on,
-- service role only).
-- IDEMPOTENT. IF NOT EXISTS / DROP CONSTRAINT IF EXISTS. Rollback: ROLLBACK_V1.10.1__own_plans_library_decision.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS library_decision TEXT;
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS library_decided_by UUID REFERENCES users(id);
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS library_decided_at TIMESTAMPTZ;
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS library_reject_reason TEXT;

ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_library_decision_values;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_library_decision_values
  CHECK (library_decision IS NULL OR library_decision IN ('approved', 'rejected'));
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_library_decision_who;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_library_decision_who
  CHECK ((library_decision IS NULL) = (library_decided_at IS NULL) AND (library_decision IS NULL) = (library_decided_by IS NULL));
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_library_reason;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_library_reason
  CHECK (library_reject_reason IS NULL OR library_decision = 'rejected');

CREATE INDEX IF NOT EXISTS idx_lp612_own_plans_shelf
  ON niete_lp612_own_plans (segment_id, lesson_id) WHERE library_decision = 'approved';
CREATE INDEX IF NOT EXISTS idx_lp612_own_plans_review_queue
  ON niete_lp612_own_plans (reviewed_at) WHERE library_eligible AND library_decision IS NULL;

COMMENT ON COLUMN niete_lp612_own_plans.library_decision IS 'A person''s check before listing: approved | rejected; NULL = undecided (not listed).';
COMMENT ON COLUMN niete_lp612_own_plans.library_decided_by IS 'users.id of the reviewer (app_settings portal_lp_own_reviewers).';
COMMENT ON COLUMN niete_lp612_own_plans.library_decided_at IS 'When the reviewer decided.';
COMMENT ON COLUMN niete_lp612_own_plans.library_reject_reason IS 'Why it was not listed; only on a rejection.';

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT count(*) FROM niete_lp612_own_plans WHERE library_decision IS NOT NULL;  -- 0
