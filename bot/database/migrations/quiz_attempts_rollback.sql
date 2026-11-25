-- Rollback migration for quiz_attempts.sql. Removes the attempt record. (To stop writes without dropping
-- anything, set app_settings web_quiz_keep_attempts to false instead.)
-- destructive: reviewed — drops only the table quiz_attempts.sql created; nothing else reads it.
DROP TABLE IF EXISTS public.quiz_attempts;
