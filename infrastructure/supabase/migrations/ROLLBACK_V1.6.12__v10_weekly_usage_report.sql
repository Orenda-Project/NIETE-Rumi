-- ROLLBACK V1.6.12 — v10 weekly usage report (reverses migration V1.6.12).
-- destructive: reviewed — removes only what V1.6.12 added: the weekly_usage_report rows (the narrow CHECK
-- cannot be restored while they exist), the two settings rows, and the third kind in the CHECK.
-- Export the weekly_usage_report rows first if the A/B read has not used them yet.
BEGIN;
DELETE FROM teacher_nudges WHERE kind = 'weekly_usage_report';
DELETE FROM app_settings WHERE key IN ('v10_weekly_report_enabled', 'v10_weekly_report_templates');
ALTER TABLE teacher_nudges DROP CONSTRAINT IF EXISTS teacher_nudges_kind_check;
ALTER TABLE teacher_nudges ADD CONSTRAINT teacher_nudges_kind_check
  CHECK (kind IN ('coaching_after_lp', 'lp_quiz_offer'));
COMMIT;
NOTIFY pgrst, 'reload schema';
