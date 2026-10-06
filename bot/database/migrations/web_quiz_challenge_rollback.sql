-- Rollback of web_quiz_challenge.sql: drops the Challenge runs (no other table references it).
DROP TABLE IF EXISTS public.web_quiz_challenge_runs;
