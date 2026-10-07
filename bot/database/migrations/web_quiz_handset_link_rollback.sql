-- Rollback of web_quiz_handset_link.sql: the function and the index. Merges already executed are
-- undone by id from record_history (op = 'UPDATE', old_vals.merge = true, actor as given), not by this file.
DROP FUNCTION IF EXISTS public.web_quiz_merge_student(uuid, uuid, text);
DROP INDEX IF EXISTS public.idx_quiz_sessions_device_ref;
