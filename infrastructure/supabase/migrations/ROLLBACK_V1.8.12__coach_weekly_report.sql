-- ROLLBACK of the versioned migration V1.8.12 (infrastructure/supabase/migrations) — removes the 'coach_weekly_report' kind. Its rows must go first (the CHECK would refuse them):
-- they hold only "opened / closed / messaged" per coach per week, and a week could be messaged again if the sweep
-- returns. Run AFTER app_settings.coach_reports_app is off and the code that writes the kind is rolled back.
-- NO BEGIN/COMMIT: exec_sql refuses transaction control (V1.8.0).

-- destructive: reviewed — only the rows of the kind V1.8.12 added.
DELETE FROM teacher_nudges WHERE kind = 'coach_weekly_report';
ALTER TABLE teacher_nudges DROP CONSTRAINT IF EXISTS teacher_nudges_kind_check;
ALTER TABLE teacher_nudges ADD CONSTRAINT teacher_nudges_kind_check
  CHECK (kind IN ('coaching_after_lp', 'lp_quiz_offer', 'weekly_usage_report', 'topic_end_nudge'));

NOTIFY pgrst, 'reload schema';
