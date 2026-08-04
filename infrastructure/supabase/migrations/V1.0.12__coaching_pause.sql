-- V1.0.12  Coaching pause / resume (bd-2508 follow-up)
--
-- Before this, any "/" message during `conducting_conversation` set the session to
-- `abandoned` with no warning: escaping the 269-hour trap and destroying the
-- reflection were the same action. The fix adds a third state — `paused` — so a
-- teacher who switches to another service keeps her remaining questions and gets
-- one evening nudge to finish.
--
-- Additive only: three nullable columns, no backfill, no existing row written.
-- `status = 'paused'` is a new VALUE, not a schema change — there is no CHECK
-- constraint on coaching_sessions.status (verified live 2026-08-04).
--
-- NOTE on the existing partial index `idx_coaching_sessions_stale`
-- (ON (status, created_at) WHERE status = 'conducting_conversation'): a paused row
-- falls OUT of that index, which is correct — the 12h auto-complete path must not
-- see it. The new partial index below serves the evening-reminder query instead.
--
-- Shared DB (prod/staging/QA share one Postgres): applying this is global.
-- Idempotent — safe to re-run.
-- UP ------------------------------------------------------------------------
ALTER TABLE coaching_sessions
  ADD COLUMN IF NOT EXISTS paused_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_reason             TEXT,
  ADD COLUMN IF NOT EXISTS evening_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN coaching_sessions.paused_at IS
  'When a conducting_conversation session was paused because the teacher switched '
  'to another service (bd-2508 follow-up). NULL unless status = ''paused''. Distinct '
  'from updated_at, which every write bumps.';

COMMENT ON COLUMN coaching_sessions.pause_reason IS
  'Why the session paused, e.g. ''switched_to:/video''. Diagnostics only.';

COMMENT ON COLUMN coaching_sessions.evening_reminder_sent_at IS
  'When the 20:00-22:00 Asia/Karachi nudge was sent for this pause. Deliberately '
  'SEPARATE from reminder_sent_at, which the 2h stale reminder owns — sharing one '
  'column would make either ping suppress the other. Cleared on resume.';

-- Serves processPausedCoachingReminders(): paused rows still awaiting a nudge.
CREATE INDEX IF NOT EXISTS idx_coaching_sessions_paused_pending
  ON coaching_sessions (paused_at)
  WHERE status = 'paused' AND evening_reminder_sent_at IS NULL;

-- PostgREST schema-cache reload (house convention — keep last).
NOTIFY pgrst, 'reload schema';

-- DOWN ----------------------------------------------------------------------
-- Paused sessions become `abandoned`, i.e. exactly the pre-fix behaviour.
-- BEGIN;
-- DROP INDEX IF EXISTS idx_coaching_sessions_paused_pending;
-- UPDATE coaching_sessions SET status = 'abandoned' WHERE status = 'paused';
-- ALTER TABLE coaching_sessions
--   DROP COLUMN IF EXISTS paused_at,
--   DROP COLUMN IF EXISTS pause_reason,
--   DROP COLUMN IF EXISTS evening_reminder_sent_at;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
