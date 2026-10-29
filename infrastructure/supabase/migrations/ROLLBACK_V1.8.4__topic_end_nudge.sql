-- ROLLBACK V1.8.4 — topic-end nudge (reverses migration V1.8.4).
-- destructive: reviewed — removes only what V1.8.4 added: the topic_end_nudge rows (the narrow CHECK cannot be
-- restored while they exist), the switch, the assignment table, and the fourth kind in the CHECK.
-- Export the topic_end_nudge rows and the assignment table first if the A/B read has not used them yet.
DELETE FROM teacher_nudges WHERE kind = 'topic_end_nudge';
DELETE FROM app_settings WHERE key = 'topic_end_nudge_enabled';
DROP TABLE IF EXISTS niete_topic_nudge_ab_assignment;
ALTER TABLE teacher_nudges DROP CONSTRAINT IF EXISTS teacher_nudges_kind_check;
ALTER TABLE teacher_nudges ADD CONSTRAINT teacher_nudges_kind_check
  CHECK (kind IN ('coaching_after_lp', 'lp_quiz_offer', 'weekly_usage_report'));
NOTIFY pgrst, 'reload schema';
