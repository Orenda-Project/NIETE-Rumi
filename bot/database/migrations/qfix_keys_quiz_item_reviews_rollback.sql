-- Rollback for qfix_keys_quiz_item_reviews.sql. Every flagged item and every reviewer verdict is lost; the worker's
-- nightly tick then fails its counts call and logs the error (switch quiz_key_review_job should be removed first).
DROP FUNCTION IF EXISTS public.quiz_key_answer_counts(integer, integer);
DROP TABLE IF EXISTS public.quiz_item_reviews;
