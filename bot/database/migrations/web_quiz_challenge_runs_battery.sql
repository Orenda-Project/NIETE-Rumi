-- requires: web_quiz_challenge.sql (makes web_quiz_challenge_runs and its inline exercise CHECK)
-- Migration: a run row's exercise admits 'battery' (the big flight: one part of the reading and number battery played
-- as a game, sa-game/store-adapter.js; written only by code behind the sa_game switch).
--
-- ADDITIVE and re-runnable. No column is added or changed, no row is rewritten. The exercise CHECK is dropped and made
-- again with one more value:
--   web_quiz_challenge_runs_exercise_check  exercise IN ('listen','sounds','read','numbers','bigger','missing','sums','battery')
-- Every value the CHECK allowed before is still allowed, so every existing row passes. A battery row is never a record
-- (record NULL: the record locks in web_quiz_challenge_runs_record_locks.sql never see it).
-- No transaction control of its own (the tool that applies migrations runs it in one). One env = one DB. Apply after web_quiz_challenge.sql; sandbox first, staging and prod only on a go.
-- Rollback: web_quiz_challenge_runs_battery_rollback.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_quiz_challenge_runs_exercise_check'
                   AND conrelid = 'public.web_quiz_challenge_runs'::regclass
                   AND pg_get_constraintdef(oid) LIKE '%battery%') THEN
    ALTER TABLE public.web_quiz_challenge_runs DROP CONSTRAINT IF EXISTS web_quiz_challenge_runs_exercise_check;
    ALTER TABLE public.web_quiz_challenge_runs ADD CONSTRAINT web_quiz_challenge_runs_exercise_check
      CHECK (exercise IN ('listen', 'sounds', 'read', 'numbers', 'bigger', 'missing', 'sums', 'battery'));
  END IF;
END $$;
