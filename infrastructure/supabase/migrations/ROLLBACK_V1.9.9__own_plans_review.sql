-- Rollback for V1.9.9 (bd-snkn32.16). Drops the reviewer's verdict; her plans and their rows are untouched.
DROP INDEX IF EXISTS idx_lp612_own_plans_library;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_library_needs_pass;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_review_score_range;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS library_eligible;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS reviewed_at;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS review_model;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS review_items;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS review_pass;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS review_score;
NOTIFY pgrst, 'reload schema';
