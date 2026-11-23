-- Rollback: qfix_class_link_evening_round.sql. Drops the two indexes only; rounds already written stay as quizzes
-- rows (switch web_quiz_evening_round off and nothing reads them).
DROP INDEX IF EXISTS public.quiz_sessions_student_done;
DROP INDEX IF EXISTS public.quizzes_evening_round_one;
