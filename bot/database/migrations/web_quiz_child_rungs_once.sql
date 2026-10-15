-- requires: web_quiz_challenge_runs_v2.sql (creates child_rungs; it in turn needs web_quiz_challenge.sql)
-- Migration: a child's reading/numbers lamp changes at most once per ladder per stop per period.
--
-- ADDITIVE and re-runnable. On child_rungs:
--   stop   text, NULL by default, CHECK (read | listen | missing | bigger): the Trail stop whose record row set the lamp
--   child_rungs_once_per_stop_idx  UNIQUE (canonical_id, ladder, stop, period_id)
--   UPDATE and DELETE revoked from service_role, authenticated and anon: one row per rung change, never updated or
--   deleted (the history is the audit). INSERT and SELECT stay; no code path updates or deletes child_rungs.
-- The rung job (bot/shared/services/quiz/web-quiz-rungs.js, behind web_quiz_challenge_rungs, off by default) appends
-- one row per rung change with stop = the run's exercise, and treats this index's refusal as "already set on this stop
-- this period". So a listen and a read in one month can each move the Reading lamp once. No row is written or
-- rewritten here. Base: web_quiz_challenge_runs_v2.sql (creates child_rungs with RLS on; re-asserted below, a no-op
-- when it is already on). child_rungs has no writer before this change, so the index builds on an empty table.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go. Rollback:
-- web_quiz_child_rungs_once_rollback.sql, which runs BEFORE web_quiz_challenge_runs_v2_rollback.sql.

BEGIN;

ALTER TABLE public.child_rungs ADD COLUMN IF NOT EXISTS stop text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_rungs_stop_chk' AND conrelid = 'public.child_rungs'::regclass) THEN
    ALTER TABLE public.child_rungs ADD CONSTRAINT child_rungs_stop_chk CHECK (stop IN ('read', 'listen', 'missing', 'bigger'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS child_rungs_once_per_stop_idx
  ON public.child_rungs (canonical_id, ladder, stop, period_id);

ALTER TABLE public.child_rungs ENABLE ROW LEVEL SECURITY;

REVOKE UPDATE, DELETE ON public.child_rungs FROM service_role, authenticated, anon;

COMMENT ON COLUMN public.child_rungs.stop IS
  'Internal. The Trail stop (read | listen | missing | bigger) whose record row set this lamp; one change per child × ladder × stop × period.';

COMMIT;
