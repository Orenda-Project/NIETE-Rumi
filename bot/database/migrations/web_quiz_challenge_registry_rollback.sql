-- Rollback of web_quiz_challenge_registry.sql (and its seed): drops the five registry tables, dependents first.
-- Nothing outside these five tables references them; web_quiz_challenge_runs is untouched.
DROP TABLE IF EXISTS public.challenge_draws;
DROP TABLE IF EXISTS public.challenge_links;
DROP TABLE IF EXISTS public.challenge_periods;
DROP TABLE IF EXISTS public.challenge_items;
DROP TABLE IF EXISTS public.challenge_passages;

