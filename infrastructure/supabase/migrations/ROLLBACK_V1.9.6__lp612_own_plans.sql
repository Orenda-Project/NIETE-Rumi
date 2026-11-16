-- Rollback for V1.9.6 (bd-snkn32). Drops the Make-my-own fork table. R2 objects under lp612/*/edits/ are left in place.
DROP TABLE IF EXISTS niete_lp612_own_plans;
NOTIFY pgrst, 'reload schema';
