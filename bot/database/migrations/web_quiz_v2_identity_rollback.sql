-- Rollback for web_quiz_v2_identity.sql. The hand-out bindings are lost; codes
-- then resolve their class at read time, as before the migration.
DROP INDEX IF EXISTS public.idx_quiz_share_codes_class;
ALTER TABLE public.quiz_share_codes DROP COLUMN IF EXISTS class_id;
