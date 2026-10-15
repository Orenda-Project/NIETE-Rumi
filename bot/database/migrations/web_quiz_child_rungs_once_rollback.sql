-- Rollback of web_quiz_child_rungs_once.sql: drops the once-per-stop index, the stop CHECK and the stop column only;
-- every lamp row stays. Run it before web_quiz_challenge_runs_v2_rollback.sql (which drops child_rungs). Switch
-- web_quiz_challenge_rungs off first: without the index the job could write a second change on a stop in one period.

BEGIN;

DROP INDEX IF EXISTS public.child_rungs_once_per_stop_idx;
ALTER TABLE public.child_rungs DROP CONSTRAINT IF EXISTS child_rungs_stop_chk;
ALTER TABLE public.child_rungs DROP COLUMN IF EXISTS stop;

COMMIT;
