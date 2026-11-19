-- Rollback for V1.10.3 (bd-snkn32.11). Drops teachers' ratings of their own plans; the plans and rows are untouched.
-- Roll back only with the code that writes them: without the columns, saving a rating fails (she sees "try again").
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_teacher_rated_when;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_teacher_confusing;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_teacher_rating_range;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS teacher_rated_at;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS teacher_confusing;
ALTER TABLE niete_lp612_own_plans DROP COLUMN IF EXISTS teacher_rating;
NOTIFY pgrst, 'reload schema';
