-- Transcript quiz (post-coaching quiz offer → student link → 12h report).
--
-- ADDITIVE ONLY. Nothing here is read by existing code paths, so applying it
-- changes no behaviour until the feature flag is set on a service.
--
-- Explored live (staging, 2026-09-05) before writing:
--   quizzes: 17 columns, no coaching link, status CHECK =
--     generating|ready|sent|report_sent|failed|cancelled
--   indexes: idx_quizzes_teacher_id (teacher_id), idx_quizzes_status,
--            idx_quizzes_video_id (partial unique)
-- One env = one DB. Apply to STAGING first; prod only on an explicit go.

-- ─── up ─────────────────────────────────────────────────────────────────────

-- The coaching session this quiz was written from. NULL for every other
-- quiz_source (lesson_plan, video).
ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS coaching_session_id uuid
    REFERENCES public.coaching_sessions(id) ON DELETE SET NULL;

-- The language the QUESTIONS are written in ('ur' | 'en'). Decided by the
-- subject rule in code, never by the market default.
ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS language text;

-- Everything else the feature needs rides here rather than as columns:
-- the lesson digest (SLOs, taught level, key terms), model + cost, the PDF's
-- R2 key, the offer/decline timestamps. Anti-sprawl (root rule 15).
ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Three new states for the offer lifecycle. 'offered' = digest done and the
-- yes/no sent; 'declined' = she tapped no; 'skipped' = the gate said the
-- transcript could not carry a quiz (reason in meta.skip_reason).
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_status_check;
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_status_check CHECK (
  status = ANY (ARRAY[
    'generating'::text, 'ready'::text, 'sent'::text, 'report_sent'::text,
    'failed'::text, 'cancelled'::text,
    'offered'::text, 'declined'::text, 'skipped'::text
  ])
);

-- One transcript quiz per coaching session. This is the idempotency anchor
-- for the whole pipeline: the offer job, the early survey trigger and a /quiz
-- tap all try to INSERT, and exactly one wins.
CREATE UNIQUE INDEX IF NOT EXISTS quizzes_one_transcript_quiz_per_session
  ON public.quizzes (coaching_session_id)
  WHERE quiz_source = 'transcript';

-- /quiz lists a teacher's recent quizzes newest-first. idx_quizzes_teacher_id
-- covers the equality but not the ORDER BY; this one covers both.
CREATE INDEX IF NOT EXISTS quizzes_teacher_recent
  ON public.quizzes (teacher_id, created_at DESC);

-- ─── down ───────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS public.quizzes_teacher_recent;
-- DROP INDEX IF EXISTS public.quizzes_one_transcript_quiz_per_session;
-- ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_status_check;
-- ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_status_check CHECK (
--   status = ANY (ARRAY['generating','ready','sent','report_sent','failed','cancelled']));
-- ALTER TABLE public.quizzes
--   DROP COLUMN IF EXISTS meta, DROP COLUMN IF EXISTS language,
--   DROP COLUMN IF EXISTS coaching_session_id;
