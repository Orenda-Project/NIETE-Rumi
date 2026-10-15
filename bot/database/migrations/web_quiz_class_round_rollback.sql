-- Rollback of web_quiz_class_round.sql: drops the class round draws (no other table references it).
DROP TABLE IF EXISTS public.class_round_draws;
