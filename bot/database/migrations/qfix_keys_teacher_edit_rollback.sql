-- Rollback of qfix_keys_teacher_edit.sql. Export the audit first (it is the only record of what teachers changed):
--   \copy (SELECT * FROM public.quiz_teacher_edits ORDER BY created_at) TO 'quiz_teacher_edits_<env>_<stamp>.csv' CSV HEADER
-- The widened reason CHECK stays (a superset: harmless), and so do the 'teacher_edit' rows in quiz_item_reviews: a key
-- a teacher fixed is still the right key. The edited quiz rows stay as the teachers left them; to undo an edit, run
-- bot/scripts/quiz-teacher-edit-revert.js BEFORE this file (it reads the audit this file drops).
DROP FUNCTION IF EXISTS public.quiz_teacher_edit_pdf(uuid, integer, text);
DROP FUNCTION IF EXISTS public.quiz_teacher_edit_apply(uuid, uuid, integer, jsonb, integer, text);
DROP FUNCTION IF EXISTS public.quiz_teacher_edit_words(jsonb);
DROP TABLE IF EXISTS public.quiz_teacher_edits;
