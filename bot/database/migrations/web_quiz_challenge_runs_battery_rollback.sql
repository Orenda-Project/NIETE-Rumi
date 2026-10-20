-- Rollback of web_quiz_challenge_runs_battery.sql: the exercise CHECK back to the seven values web_quiz_challenge.sql made
-- it with. No row is touched: the restored CHECK is NOT VALID, so a 'battery' row written meanwhile stays as it is, and
-- only new writes are held to the earlier values.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_quiz_challenge_runs_exercise_check'
               AND conrelid = 'public.web_quiz_challenge_runs'::regclass
               AND pg_get_constraintdef(oid) LIKE '%battery%') THEN
    ALTER TABLE public.web_quiz_challenge_runs DROP CONSTRAINT web_quiz_challenge_runs_exercise_check;
    ALTER TABLE public.web_quiz_challenge_runs ADD CONSTRAINT web_quiz_challenge_runs_exercise_check
      CHECK (exercise IN ('listen', 'sounds', 'read', 'numbers', 'bigger', 'missing', 'sums')) NOT VALID;
  END IF;
END $$;
