-- Rollback for V1.9.8 (bd-snkn32.15). Removes change rows (their R2 objects under lp612/ stay), then the index,
-- the constraint and the columns.
DELETE FROM niete_lp612_own_plans WHERE parent_own_id IS NOT NULL;
DROP INDEX IF EXISTS uq_lp612_own_plans_round;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_edit_round;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS edit_request;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS edit_round;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS parent_own_id;
NOTIFY pgrst, 'reload schema';
