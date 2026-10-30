-- requires: (none; users exists)
-- Migration: coach_feedback — a coach's "Report an issue" from the portal's More page (bd-whlsm0).
--
-- NON-DESTRUCTIVE. One new table; nothing existing changes shape. Apply to sandbox first; staging and prod only on a
-- go. Rollback: coach_feedback_rollback.sql.
--
-- Written by POST /api/portal/coach/feedback (dashboard/routes/coach-feedback.routes.js) for the logged-in coach only.
-- Read by nobody in the app yet: the operator reviews it ("later on we'll figure out how to make sure that we are
-- always registering the kind of feedback that we're getting from the coaches"). status is there for that review.
--
-- Owner: NIETE portal team. Steward: Hataf Atif.
-- Sensitivity (D6): id, kind, status, created_at, updated_at Internal; user_id Confidential (links to a person);
-- page Internal; message Confidential (free text, may name a teacher or a school; never logged).

CREATE TABLE IF NOT EXISTS public.coach_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('broken', 'numbers', 'idea', 'other')),
  message     text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
  page        text CHECK (page IS NULL OR (page LIKE '/portal/%' AND char_length(page) <= 200)),
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'done')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_feedback_created_at_idx ON public.coach_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS coach_feedback_user_id_idx ON public.coach_feedback (user_id);

COMMENT ON TABLE public.coach_feedback IS
  'A coach''s report from the portal (More → Report an issue), bd-whlsm0. Owner: NIETE portal team; steward: Hataf Atif. Written only by the server for the session coach.';
COMMENT ON COLUMN public.coach_feedback.id IS '[Internal] the report';
COMMENT ON COLUMN public.coach_feedback.user_id IS '[Confidential] the coach who sent it (users.id)';
COMMENT ON COLUMN public.coach_feedback.kind IS '[Internal] broken = something is not working; numbers = numbers look wrong; idea; other';
COMMENT ON COLUMN public.coach_feedback.message IS '[Confidential] what she wrote, trimmed, 1-2000 characters; free text that may name people; never logged';
COMMENT ON COLUMN public.coach_feedback.page IS '[Internal] the portal address she sent it from, when known';
COMMENT ON COLUMN public.coach_feedback.status IS '[Internal] the review: new, seen or done';
COMMENT ON COLUMN public.coach_feedback.created_at IS '[Internal] when she sent it (UTC)';
COMMENT ON COLUMN public.coach_feedback.updated_at IS '[Internal] row last changed (UTC); set by trigger';
DROP TRIGGER IF EXISTS coach_feedback_updated_at ON public.coach_feedback;
CREATE TRIGGER coach_feedback_updated_at BEFORE UPDATE ON public.coach_feedback FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE public.coach_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_coach_feedback ON public.coach_feedback;
CREATE POLICY service_role_coach_feedback ON public.coach_feedback FOR ALL USING (auth.role() = 'service_role');
GRANT ALL ON public.coach_feedback TO service_role;
