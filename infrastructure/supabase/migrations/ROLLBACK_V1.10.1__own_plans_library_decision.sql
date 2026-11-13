-- Rollback for V1.10.1 (bd-snkn32.42). Drops the reviewers' decisions; her plans and their rows are untouched.
-- Roll back only with the code that reads them: without library_decision the shelf query fails (empty shelf).
DROP INDEX IF EXISTS idx_lp612_own_plans_review_queue;
DROP INDEX IF EXISTS idx_lp612_own_plans_shelf;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_library_reason;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_library_decision_who;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_library_decision_values;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS library_reject_reason;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS library_decided_at;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS library_decided_by;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS library_decision;
NOTIFY pgrst, 'reload schema';
