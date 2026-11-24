-- requires: web_quiz_v1.sql
-- Migration: keep every quiz attempt (quiz_attempts), with the answer key and quiz maker that marked it.
--
-- NON-DESTRUCTIVE. One new table; nothing existing changes.
-- Owner: quiz team. Steward: the NIETE bot team. Written by the bot's service role only (RLS on, no policy).
--
-- Why a new table (schema-first): quiz_answers is the per-attempt record today, but it cascades from quiz_questions
-- (a remake or cache hit deletes and re-inserts a quiz's questions, taking played answers with them) and from
-- quiz_sessions (which cascades from quizzes and students); and an answer key fixed in place leaves no trace of the
-- key an earlier attempt was marked by. A column on quiz_sessions would go with the same cascades. This table holds
-- what those rows cannot: a snapshot that outlives them. Every reference here is ON DELETE SET NULL, so a delete
-- elsewhere detaches the row instead of removing it.
--
--   one row per finished attempt (bot/shared/services/quiz/quiz-attempt-log.js)
--   answers        [{qid, picked, ok, key, item}]  pick, verdict given, key that gave it, 12-hex hash of the item shown
--   key_version    16-hex hash of the served items' keys at marking time (a fixed key gives a new value)
--   items_version  16-hex hash of the served items' content (the quiz maker rewriting questions gives a new value)
--   quiz_source, quiz_made_at  which quiz maker, and when (its code at that date is in git history)
--   marker_commit  the bot commit that marked the attempt
-- No name, phone or free text of the child is stored. Retention: as quiz_sessions (no separate purge).
--
-- Writes start only when app_settings key web_quiz_keep_attempts holds JSON true (no row = off); this file adds no row.
-- Rollback: quiz_attempts_rollback.sql.
-- Every statement is IF NOT EXISTS: applying it twice is a no-op.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid        REFERENCES public.quiz_sessions(id) ON DELETE SET NULL,
  quiz_id        uuid        REFERENCES public.quizzes(id) ON DELETE SET NULL,
  student_id     uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  share_code_id  uuid        REFERENCES public.quiz_share_codes(id) ON DELETE SET NULL,
  channel        text        NOT NULL CHECK (channel IN ('web', 'whatsapp', 'video')),
  status         text        NOT NULL CHECK (status IN ('completed', 'incomplete')),
  correct        integer     NOT NULL CHECK (correct >= 0),
  total          integer     NOT NULL CHECK (total >= correct),
  answers        jsonb       NOT NULL CHECK (jsonb_typeof(answers) = 'array'),
  key_version    text        NOT NULL,
  items_version  text        NOT NULL,
  quiz_source    text,
  quiz_made_at   timestamptz,
  marker_commit  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One row per finished session: a repeated finish call is refused (23505), not a second attempt.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_attempts_session_uq
  ON public.quiz_attempts (session_id) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS quiz_attempts_quiz_idx
  ON public.quiz_attempts (quiz_id, created_at);
CREATE INDEX IF NOT EXISTS quiz_attempts_student_idx
  ON public.quiz_attempts (student_id, created_at);

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.quiz_attempts IS
  'one append-only row per finished quiz attempt: answers, score, key_version, items_version, quiz maker; written only by the bot (service role)';
