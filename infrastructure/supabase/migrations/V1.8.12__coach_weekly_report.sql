-- V1.8.12 — coach reports in the app, phase 3: a fifth teacher_nudges kind, 'coach_weekly_report'.
-- Versioned migration in infrastructure/supabase/migrations (applied per environment, in order). Follows V1.8.11.
--
-- WHAT. The coach's weekly report (Monday 00:00 to Friday 16:00 PKT) is a page in the coach app, ready every Friday at
-- 16:00. A card on her Home opens it; if she has neither opened it nor closed the card by 16:30, ONE WhatsApp message
-- brings the link. That needs, per coach per week, "opened / closed / messaged", exactly once.
--
-- WHY THIS, AND NOTHING ELSE. teacher_nudges (V1.5.3) already holds "which person, which date, sent or skipped, why",
-- with UNIQUE (user_id, nudge_date, kind) — one row per coach per week, keyed on the week's Monday, is the one-a-week
-- guarantee, and the same row is the claim: the first INSERT for (coach, Monday) wins. Opening the report or closing
-- the card inserts it as status 'skipped' (choice 'opened' | 'seen'); the 16:30 sweep inserts it as 'sending' and then
-- marks it 'sent' or 'failed'; whoever is first, the other finds the row and does nothing. user_id references users,
-- which coaches are. The report's numbers are not stored: they are computed from her debriefs when the page asks.
-- A new kind is a migration on purpose (V1.5.3); this is that migration. The weekly usage report (V1.6.12) is the
-- precedent for a weekly kind.
--
-- DATA. A coach id, a date, a status, a timestamp, 'opened'/'seen'. No names, no phone, no message text.
-- OFF BY DEFAULT. Nothing writes the kind unless app_settings.coach_reports_app lists the coach.
-- NO BEGIN/COMMIT: exec_sql refuses transaction control (V1.8.0).
-- IDEMPOTENT: the CHECK is dropped and re-added by name, listing every kind in use (V1.8.4's four plus this one).
-- Rollback: ROLLBACK_V1.8.12__coach_weekly_report.sql

ALTER TABLE teacher_nudges DROP CONSTRAINT IF EXISTS teacher_nudges_kind_check;
ALTER TABLE teacher_nudges ADD CONSTRAINT teacher_nudges_kind_check
  CHECK (kind IN ('coaching_after_lp', 'lp_quiz_offer', 'weekly_usage_report', 'topic_end_nudge', 'coach_weekly_report'));

NOTIFY pgrst, 'reload schema';
