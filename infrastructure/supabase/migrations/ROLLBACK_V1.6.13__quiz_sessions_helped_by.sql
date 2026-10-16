-- ROLLBACK for V1.6.13 — drops quiz_sessions.helped_by and its CHECK.
--
-- Loses every "who helped?" answer recorded since V1.6.13. Switch app_settings
-- quiz_slo_retest_enabled off FIRST: with it on, the bot keeps asking and its writes fail (logged,
-- the child is still thanked). IDEMPOTENT.

ALTER TABLE quiz_sessions DROP CONSTRAINT IF EXISTS quiz_sessions_helped_by_chk;
ALTER TABLE quiz_sessions DROP COLUMN IF EXISTS helped_by;

NOTIFY pgrst, 'reload schema';
