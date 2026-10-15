-- Migration: a child's reading/numbers lamp changes at most once per ladder per period.
--
-- ADDITIVE and re-runnable. One unique index on child_rungs (canonical_id, ladder, period_id): the rung job
-- (bot/shared/services/quiz/web-quiz-rungs.js, behind web_quiz_challenge_rungs, off by default) appends one row per
-- rung change and treats this index's refusal as "already set this period". No row is written or rewritten here.
-- Base: web_quiz_challenge_runs_v2.sql (creates child_rungs with RLS on; re-asserted below, a no-op when on).
-- child_rungs has no writer before this change, so the index builds on an empty table. One env = one DB.
-- Apply to sandbox first; staging and prod only on a go. Rollback: web_quiz_child_rungs_once_rollback.sql, which runs
-- BEFORE web_quiz_challenge_runs_v2_rollback.sql.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS child_rungs_once_per_period_idx
  ON public.child_rungs (canonical_id, ladder, period_id);

ALTER TABLE public.child_rungs ENABLE ROW LEVEL SECURITY;

COMMIT;
