-- Rollback of web_quiz_live_read_keys.sql: drops the story-page key counts (no other table references it).
DROP TABLE IF EXISTS public.web_quiz_live_read_keys;
