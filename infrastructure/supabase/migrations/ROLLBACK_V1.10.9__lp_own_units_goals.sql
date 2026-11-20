-- Rollback for V1.10.9 (bd-snkn32.59.4). Goal-unit day plans (no segment, no book day) go first: the old check
-- cannot hold them. Goal units go with them (book_stem was NULL for them).
DELETE FROM niete_lp612_own_plans WHERE segment_id IS NULL AND lesson_id IS NULL;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_one_parent;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_one_parent CHECK (num_nonnulls(segment_id, lesson_id) = 1);
DELETE FROM niete_lp_own_units WHERE start_kind = 'goals';
ALTER TABLE niete_lp_own_units DROP CONSTRAINT IF EXISTS niete_lp_own_units_book;
ALTER TABLE niete_lp_own_units DROP CONSTRAINT IF EXISTS niete_lp_own_units_goals;
ALTER TABLE niete_lp_own_units ALTER COLUMN book_stem SET NOT NULL;
ALTER TABLE niete_lp_own_units RENAME COLUMN goals TO goal_codes;
ALTER TABLE niete_lp_own_units ADD CONSTRAINT niete_lp_own_units_goals CHECK (start_kind <> 'goals' OR cardinality(goal_codes) BETWEEN 2 AND 8);
NOTIFY pgrst, 'reload schema';
