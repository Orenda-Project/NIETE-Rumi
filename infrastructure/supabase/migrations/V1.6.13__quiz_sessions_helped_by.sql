-- V1.6.13 — quiz_sessions.helped_by: the child's one-tap "who helped?" answer (bd-v0toag.10).
-- Versioned migration in infrastructure/supabase/migrations (applied per environment, in order).
-- Follows V1.6.12 (weekly report, bd-v0toag.32). Rollback: ROLLBACK_V1.6.13__quiz_sessions_helped_by.sql
--
-- WHY. After a child finishes a lesson quiz on WhatsApp the bot asks once "who helped you?" —
-- no one / a classmate / my teacher / my family (bot/shared/services/quiz/quiz-helped-by.js).
-- The answer belongs to that attempt, so it sits on the attempt's row. Written only while
-- app_settings quiz_slo_retest_enabled is on (default off); first answer wins (UPDATE … WHERE
-- helped_by IS NULL).
--
-- WHY NOT AN EXISTING PLACE (Rule 15, anti-sprawl). quiz_sessions has no jsonb column to carry
-- it; web_quiz_challenge_runs.helped is the Challenge's own table with a different, three-value
-- meaning (self / helped / not_asked); quiz_answers is per question; an event log alone cannot
-- feed a report. One nullable column, no new table, no index (nothing filters on it yet).
--
-- NOT YET MEASURED LIVE: designed from this repo's schema (00_complete-schema.sql). Before applying,
-- confirm on the target that quiz_sessions has no helped_by column (information_schema.columns).
--
-- SAFETY: ADD COLUMN with no default is metadata-only — no rewrite, a brief ACCESS EXCLUSIVE lock.
-- The CHECK is added NOT VALID then validated; every existing row is NULL so validation is a scan
-- with no failures. IDEMPOTENT: re-running is a no-op.

ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS helped_by text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sessions_helped_by_chk' AND conrelid = 'quiz_sessions'::regclass) THEN
    ALTER TABLE quiz_sessions ADD CONSTRAINT quiz_sessions_helped_by_chk
      CHECK (helped_by IN ('no_one', 'classmate', 'teacher', 'family')) NOT VALID;
    ALTER TABLE quiz_sessions VALIDATE CONSTRAINT quiz_sessions_helped_by_chk;
  END IF;
END $$;

COMMENT ON COLUMN quiz_sessions.helped_by IS
  'The child''s one-tap answer to "who helped?" after a lesson quiz: no_one | classmate | teacher | family. NULL = not asked or not answered. V1.6.13 (bd-v0toag.10).';

NOTIFY pgrst, 'reload schema';
