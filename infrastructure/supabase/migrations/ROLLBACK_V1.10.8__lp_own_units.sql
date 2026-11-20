-- Rollback for V1.10.8 (bd-snkn32.59). Day plans in niete_lp612_own_plans keep answers.unit; they still open alone.
DROP TABLE IF EXISTS niete_lp_own_units;
NOTIFY pgrst, 'reload schema';
