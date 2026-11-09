-- Rollback for V1.9.7 (bd-snkn32.4). Removes grades 1-5 forks (their R2 objects under lp612/own-k5/ stay), then the column.
DELETE FROM niete_lp612_own_plans WHERE lesson_id IS NOT NULL;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_one_parent;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS lesson_id;
ALTER TABLE niete_lp612_own_plans ALTER COLUMN segment_id SET NOT NULL;
NOTIFY pgrst, 'reload schema';
