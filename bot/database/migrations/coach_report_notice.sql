-- requires: 003_classroom_coaching.sql
-- coach_report_notice.sql — coach reports in the app: three nullable timestamps on coaching_sessions, and the partial index the Home
-- card and the WhatsApp fallback read through. No new table.
-- Hand-applied, like every file here: sandbox first, then staging, then production on an explicit go.
--
-- WHAT. The coach's debrief report becomes a page in the coach app. When it is ready, a card on her Home opens it; if
-- she neither opens it nor closes the card, ONE WhatsApp message brings a link straight to it. That needs three facts
-- about the report, the same three V1.6.2/V1.6.3 keep for a teacher's ready paper:
--
--   coach_report_opened_at    she opened the report page (the Home card, the WhatsApp link, Reports). NULL = never.
--   coach_report_seen_at      she closed the Home card with ✕ (counts as seen: no message follows). NULL = never.
--   coach_report_whatsapp_at  the fallback claimed the report to message her. NULL = never. Not retried even if Meta
--                             refused the send (a missed message beats a duplicate); the refusal is logged at error.
--
-- WHY THESE COLUMNS (checked against the sandbox schema dump supabase/baseline/schema.sql, 14 Oct; no coach_report_*
-- column exists). The report IS the coaching_sessions row: its feedback is analysis_data->observer_debrief->feedback and
-- its coach is observer_user_id. "Opened", "seen" and "messaged" are three facts about that same row; a separate table
-- would need its own key and a join on every read, and could not give the one-statement claim:
--   UPDATE … SET coach_report_whatsapp_at = now() WHERE id = $1 AND coach_report_whatsapp_at IS NULL
--     AND coach_report_opened_at IS NULL AND coach_report_seen_at IS NULL RETURNING id
-- so two replicas sweeping in the same second cannot both win, and a coach who opens it a moment before is not messaged.
-- teacher_nudges is a schedule of asks to a teacher, the wrong shape for "was this report opened".
--
-- THE INDEX. The Home card asks "her coached debriefs she has neither opened nor closed", and the sweep asks "coached
-- debriefs nobody has opened, closed or messaged" — neither is served by an existing index. Partial on exactly the
-- waiting predicate, by created_at (both reads bound it: 3 days for the card, 1 day for the sweep). Load (Class R): about
-- 10 coaches, tens of debriefs a week; one bounded read per sweep tick, and nothing at all while the switch is off.
-- Rows coached before this ships stay in the index (nothing back-fills them); they are bounded out by created_at.
--
-- DATA. Timestamps only: no names, no phone, no message text. Classification: internal.
-- IDEMPOTENT: IF NOT EXISTS throughout. Rollback: coach_report_notice_rollback.sql.
-- ORDER: apply BEFORE switching coach_reports_app on for anyone. Additive and nullable; the code reads the columns only
-- for a coach with the switch on, so a deploy before the migration changes nothing for anyone else.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT. (CREATE INDEX without CONCURRENTLY: the
-- partial index covers only leader observations, a few thousand rows; the lock is momentary.)

ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS coach_report_opened_at timestamptz;
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS coach_report_seen_at timestamptz;
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS coach_report_whatsapp_at timestamptz;

COMMENT ON COLUMN coaching_sessions.coach_report_opened_at IS
  'Coach reports in the app: when the observing coach first opened her debrief report page. NULL = not opened.';
COMMENT ON COLUMN coaching_sessions.coach_report_seen_at IS
  'Coach reports in the app: when the coach closed the report''s Home card with its X (no WhatsApp follows). NULL = not.';
COMMENT ON COLUMN coaching_sessions.coach_report_whatsapp_at IS
  'Coach reports in the app: when the fallback claimed the report to message her the link. NULL = never; never retried.';

CREATE INDEX IF NOT EXISTS idx_coaching_sessions_coach_report_waiting
  ON coaching_sessions (created_at)
  WHERE observation_type = 'leader_observation'
    AND debrief_status = 'done'
    AND coach_report_opened_at IS NULL
    AND coach_report_seen_at IS NULL
    AND coach_report_whatsapp_at IS NULL;

NOTIFY pgrst, 'reload schema';
