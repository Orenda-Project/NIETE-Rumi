-- Migration: the kid's Challenge on the web quiz (short self-run exercises from the child-test battery).
--
-- NON-DESTRUCTIVE. One new table; nothing existing changes.
--
-- Why a new table (schema-first): child_test_sessions / child_test_blocks are the COACH-run battery — every
-- session needs a draw (draw_id NOT NULL FK), a coach (coach_user_id NOT NULL FK), a class (class_id NOT NULL
-- FK) and grade 3 or 5 (CHECK). A child playing alone on the web has none of these, and may be in grade 2 or
-- 4; faking a draw and a coach would put self-run rows into the coach sample and every reader of it.
-- quiz_sessions is read by the class report, the league tables and "play again", so a challenge row there
-- would count as a quiz. Nothing is stored here that a query can compute.
--
--   one row per finished run of one exercise:
--   score   bigger: {correct, n, stopped}   read: {correct, attempted, stopped, finished_early, time_left}
--   wcpm    read only: words correct per minute (EGRA Toolkit §10.3); 0 when stopped on line 1
--   meta    scoring cost/seconds, clip duration, the page's ms, a failure reason — never a transcript, never a name
--   No recording is referenced: a child's voice is scored and deleted (private child-voice/<env>/ prefix).
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS public.web_quiz_challenge_runs (
  id            uuid PRIMARY KEY,
  student_id    uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  exercise      text NOT NULL CHECK (exercise IN ('listen', 'sounds', 'read', 'numbers', 'bigger', 'missing', 'sums')),
  grade         smallint CHECK (grade BETWEEN 1 AND 12),
  lang          text CHECK (lang IN ('en', 'ur')),
  status        text NOT NULL CHECK (status IN ('scoring', 'scored', 'failed')),
  score         jsonb,
  wcpm          numeric,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  scored_at     timestamptz
);

CREATE INDEX IF NOT EXISTS web_quiz_challenge_runs_student_idx
  ON public.web_quiz_challenge_runs (student_id, exercise, created_at DESC);

ALTER TABLE public.web_quiz_challenge_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.web_quiz_challenge_runs IS
  'web quiz Challenge: one row per finished self-run exercise (bigger, read, …); written only by the bot (service role)';
