-- requires: create_video_quiz_tables.sql
-- Migration: the answer-key review queue (nightly flag of items where one wrong option drew most children).
--
-- NON-DESTRUCTIVE. One new table and one read-only function; nothing existing is touched.
-- Owner: quiz team. Steward: the NIETE bot team. Read and written by the bot's service role only (RLS on, no policy).
--
--   quiz_item_reviews        one row per (item, reason). The worker (shared/services/quiz/quiz-key-review.service.js,
--                            switch app_settings quiz_key_review_job, off when absent) inserts a suspect as 'open'
--                            and refreshes its counts while open; a person sets the verdict. A reviewed row is never
--                            reopened by the job. Holds item ids and counts only: no child, teacher or phone.
--                            reason 'blind_solve': an item a blind solver (not shown the key) answered differently,
--                            filled by a reviewed SQL go item, never by the job; top_wrong_option is the solver's pick,
--                            NULL when it found no option right, and the counts are the item's child answers.
--   quiz_key_answer_counts() per item answered in the last p_recent_days with at least p_min_answers answers: its key
--                            columns and the answer count per stored option slot. STABLE, read on the replica.
--
-- Retention: rows live as long as their quiz_questions row (ON DELETE CASCADE).
-- Every statement is IF NOT EXISTS / OR REPLACE: applying it twice is a no-op.
-- Rollback: qfix_keys_quiz_item_reviews_rollback.sql.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS public.quiz_item_reviews (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id       uuid        NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  reason            text        NOT NULL DEFAULT 'dominant_wrong_option' CHECK (reason IN ('dominant_wrong_option','blind_solve')),
  status            text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','key_wrong','ambiguous','key_ok','fixed')),
  key_at_flag       text        NOT NULL CHECK (key_at_flag ~ '^[A-D]$'),        -- the grader's key when flagged (web item key, else correct_option)
  top_wrong_option  text        CHECK (top_wrong_option ~ '^[A-D]$'),            -- stored slot, not display position; blind_solve: the solver's pick
  answers_n         integer     NOT NULL CHECK (answers_n >= 0),
  top_wrong_n       integer     NOT NULL CHECK (top_wrong_n >= 0),
  right_n           integer     NOT NULL CHECK (right_n >= 0),
  first_flagged_on  date        NOT NULL,                                        -- Pakistan date of the run
  last_seen_on      date        NOT NULL,
  reviewed_at       timestamptz,
  reviewed_by       uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  review_note       text        CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qir_one_per_reason UNIQUE (question_id, reason),
  CONSTRAINT qir_reviewed_has_when CHECK (status = 'open' OR reviewed_at IS NOT NULL),
  CONSTRAINT qir_nightly_has_wrong CHECK (reason <> 'dominant_wrong_option' OR top_wrong_option IS NOT NULL)
);
COMMENT ON TABLE public.quiz_item_reviews IS 'Answer-key review queue: items where one wrong option drew most children. Owner quiz team; steward the NIETE bot team. Service role only. Item ids and counts only.';
COMMENT ON COLUMN public.quiz_item_reviews.reviewed_by IS 'Internal: the staff user who set the verdict';
CREATE INDEX IF NOT EXISTS qir_open_idx ON public.quiz_item_reviews (first_flagged_on) WHERE status = 'open';
ALTER TABLE public.quiz_item_reviews ENABLE ROW LEVEL SECURITY;   -- no policy: service role only
DROP TRIGGER IF EXISTS qir_updated_at ON public.quiz_item_reviews;
CREATE TRIGGER qir_updated_at BEFORE UPDATE ON public.quiz_item_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.quiz_key_answer_counts(p_min_answers integer DEFAULT 20, p_recent_days integer DEFAULT 3)
RETURNS TABLE (question_id uuid, correct_option text, option_a text, option_b text, option_c text, option_d text,
               media jsonb, counts jsonb, answers_n integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH recent AS (
    SELECT DISTINCT a.question_id FROM public.quiz_answers a
    WHERE COALESCE(a.answered_at, a.created_at) >= now() - make_interval(days => p_recent_days)
  ), dist AS (
    SELECT a.question_id, upper(a.selected_option) AS opt, count(*)::integer AS n
    FROM public.quiz_answers a JOIN recent r ON r.question_id = a.question_id
    WHERE a.selected_option ~* '^[A-D]$'
    GROUP BY 1, 2
  ), agg AS (
    SELECT d.question_id, jsonb_object_agg(d.opt, d.n) AS counts, sum(d.n)::integer AS answers_n FROM dist d GROUP BY 1
  )
  SELECT q.id, q.correct_option, q.option_a, q.option_b, q.option_c, q.option_d, q.media, agg.counts, agg.answers_n
  FROM agg JOIN public.quiz_questions q ON q.id = agg.question_id
  WHERE agg.answers_n >= p_min_answers;
$$;
REVOKE ALL ON FUNCTION public.quiz_key_answer_counts(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_key_answer_counts(integer, integer) TO service_role;
