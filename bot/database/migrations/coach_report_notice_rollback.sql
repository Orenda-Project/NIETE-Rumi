-- requires: coach_report_notice.sql
-- coach_report_notice_rollback.sql — coach reports in the app: drops the waiting index and the three coach_report_* timestamps.
-- Run AFTER app_settings.coach_reports_app is switched off (or removed) and the code that reads the columns is rolled
-- back: a select of a missing column fails the Home card and the report page. Rolling back loses only "opened / seen /
-- messaged" facts; every report (the coaching_sessions row and its feedback) is kept. A report could be messaged again
-- if the fallback returns. One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

DROP INDEX IF EXISTS idx_coaching_sessions_coach_report_waiting;
-- destructive: reviewed — the column coach_report_notice.sql added.
ALTER TABLE coaching_sessions DROP COLUMN IF EXISTS coach_report_whatsapp_at;
-- destructive: reviewed — the column coach_report_notice.sql added.
ALTER TABLE coaching_sessions DROP COLUMN IF EXISTS coach_report_seen_at;
-- destructive: reviewed — the column coach_report_notice.sql added.
ALTER TABLE coaching_sessions DROP COLUMN IF EXISTS coach_report_opened_at;

NOTIFY pgrst, 'reload schema';
