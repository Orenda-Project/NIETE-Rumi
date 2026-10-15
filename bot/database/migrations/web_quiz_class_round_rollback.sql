-- Rollback of web_quiz_class_round.sql: drops the lines view, then the class round draws (nothing else references them).
DROP VIEW IF EXISTS public.class_round_lines_v;
DROP TABLE IF EXISTS public.class_round_draws;
