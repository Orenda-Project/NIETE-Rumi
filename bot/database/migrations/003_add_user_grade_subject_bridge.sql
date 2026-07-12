-- 003_add_user_grade_subject_bridge.sql
--
-- TEMPORARY bridge columns for the curriculum-LP intercept, added while
-- Track 01a (`user_classes` table) is being designed and shipped.
--
-- Context:
--   The intercept in shared/handlers/text-message.handler.js (`tryCurriculumLessonPlanServe`)
--   needs an integer grade (1-12) and a lowercase subject slug ('english', 'maths', ...)
--   to look up a pre-generated LP. The existing `users.grades_taught` (VARCHAR — e.g.
--   'Primary Grades') and `users.subjects_taught` (JSONB array of label strings — e.g.
--   ["English","Maths"]) are the labels the registration Flow collects; they don't map
--   cleanly to a single grade+subject pair, because a teacher may teach multiple grades.
--
--   These two columns are the minimal shim so the intercept has something to read when
--   parseSubjectAndGrade fails to extract them from the message. They will be REMOVED
--   once Track 01a lands the `user_classes` table (grade INTEGER + subject TEXT per row,
--   plus a primary-class flag).
--
-- Applied ad-hoc on live NIETE Supabase 2026-07-11 via psql. This file backfills the
-- schema-drift so future clone/rebuild is deterministic.
--
-- See: docs/migration/01a-teacher-class-profile.md for the target design.

ALTER TABLE users ADD COLUMN IF NOT EXISTS grade   INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subject TEXT;

COMMENT ON COLUMN users.grade   IS 'TEMPORARY (Track-01a bridge). Integer grade 1-12. Replaced by user_classes join.';
COMMENT ON COLUMN users.subject IS 'TEMPORARY (Track-01a bridge). Lowercase subject slug. Replaced by user_classes join.';
