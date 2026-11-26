-- requires: qfix_keys_quiz_item_reviews.sql
-- Migration: a teacher edits their own lesson quiz from the quiz page (switch app_settings web_quiz_teacher_edit, off
-- when absent; service shared/services/quiz/quiz-teacher-edit.js).
--
-- NON-DESTRUCTIVE. One new table, three functions, and one widened CHECK (a superset: every row that passed it still does).
-- Owner: quiz team. Steward: the NIETE bot team. Read and written by the bot's service role only (RLS on, no policy).
--
--   quiz_item_reviews.reason   + 'teacher_edit': the teacher corrected the key of an item children had already answered.
--                              Written by quiz_teacher_edit_apply as status 'fixed', one row per item (a second fix
--                              updates it in place). Edits made before any child answered never reach the queue.
--   quiz_teacher_edits         append-only: one row per changed field (text, option_a..d, key, remove) with the value
--                              before and after. No names or phones: the editor is the quiz's own teacher, so only the
--                              role is kept (edited_by). question_id carries no foreign key, so the row of a removed
--                              question keeps its audit (and the revert script can put it back with its id).
--   quiz_teacher_edit_apply()  the save, in ONE transaction: locks the quiz and its question rows, refuses a change that
--                              is not a key fix once a child has answered (a child answer's insert holds FOR KEY SHARE on
--                              its question row through quiz_answers_question_id_fkey, so it either is seen or waits),
--                              checks each row is still what the page drew, keeps MIN questions, writes rows + audit,
--                              and on the quiz: edit_v + 1, pdf_key and the clip versions dropped (the next Play records
--                              the changed words again; the PDF is remade by the caller).
--   quiz_teacher_edit_words()  a row's words without its key and feedback: what must not change once a child answered.
--   quiz_teacher_edit_pdf()    sets meta.pdf_key only while edit_v is still the version the PDF was made from.
--
-- Retention: audit rows live as long as their quiz (ON DELETE CASCADE).
-- Every statement is IF NOT EXISTS / OR REPLACE / a guarded constraint swap: applying it twice is a no-op.
-- Rollback: qfix_keys_teacher_edit_rollback.sql. One env = one DB. Apply to sandbox first; staging and prod only on a go.

ALTER TABLE public.quiz_item_reviews DROP CONSTRAINT IF EXISTS quiz_item_reviews_reason_check;
ALTER TABLE public.quiz_item_reviews ADD CONSTRAINT quiz_item_reviews_reason_check
  CHECK (reason IN ('dominant_wrong_option','blind_solve','teacher_edit'));

CREATE TABLE IF NOT EXISTS public.quiz_teacher_edits (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id      uuid        NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question_id  uuid        NOT NULL,                                   -- no FK: a removed question keeps its audit
  field        text        NOT NULL CHECK (field IN ('text','option_a','option_b','option_c','option_d','key','remove')),
  before       jsonb,
  after        jsonb,
  edited_by    text        NOT NULL DEFAULT 'teacher' CHECK (edited_by IN ('teacher','revert')),
  edit_v       integer     NOT NULL CHECK (edit_v >= 1),
  answered     boolean     NOT NULL DEFAULT false,                     -- a child had answered the quiz when it was saved
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.quiz_teacher_edits IS 'Teacher edits to their own quiz from the quiz page: one row per changed field, before and after. Owner quiz team; steward the NIETE bot team. Service role only. No names or phones.';
CREATE INDEX IF NOT EXISTS qte_quiz_idx ON public.quiz_teacher_edits (quiz_id, edit_v);
ALTER TABLE public.quiz_teacher_edits ENABLE ROW LEVEL SECURITY;   -- no policy: service role only

-- A row's words as the children read them: the row's edited columns without the key and the feedback that names it
-- (correct_option, explanation, misconception_feedback, distractor_misconceptions, option_feedback; in media.web:
-- key, why, fb_right and each option's fb). Once a child has answered, a save may change nothing else.
CREATE OR REPLACE FUNCTION public.quiz_teacher_edit_words(x jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (x - 'correct_option' - 'explanation' - 'misconception_feedback' - 'distractor_misconceptions' - 'option_feedback')
    || jsonb_build_object('media', CASE
         WHEN jsonb_typeof(x->'media'->'web') <> 'object' THEN x->'media'
         ELSE jsonb_set((x->'media') #- '{web,key}' #- '{web,why}' #- '{web,fb_right}', '{web,options}',
           CASE WHEN jsonb_typeof(x->'media'->'web'->'options') = 'array'
             THEN COALESCE((SELECT jsonb_agg(CASE WHEN jsonb_typeof(o) = 'object' THEN o - 'fb' ELSE o END ORDER BY i)
                            FROM jsonb_array_elements(x->'media'->'web'->'options') WITH ORDINALITY AS t(o, i)), '[]'::jsonb)
             ELSE COALESCE(x->'media'->'web'->'options', 'null'::jsonb) END)
       END);
$$;
REVOKE ALL ON FUNCTION public.quiz_teacher_edit_words(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_teacher_edit_words(jsonb) TO service_role;

-- p_changes: [{id, remove, before:{<edited columns>}, after:{<edited columns>}, fields:[{field, before, after}]}]
-- The edited columns are question_text, option_a..d, correct_option, explanation, misconception_feedback,
-- distractor_misconceptions, option_feedback, media. `before` must equal the row now (else 'stale').
CREATE OR REPLACE FUNCTION public.quiz_teacher_edit_apply(
  p_quiz_id uuid, p_teacher_id uuid, p_expect_v integer, p_changes jsonb, p_min integer, p_editor text DEFAULT 'teacher')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  q          record;
  c          jsonb;
  f          jsonb;
  r          public.quiz_questions;
  v_now      integer;
  v_next     integer;
  n_now      integer;
  n_removed  integer := 0;
  answered   boolean;
  cur        jsonb;
  reviews    integer := 0;
  old_key    text;
  new_key    text;
  cnt        record;
  top_wrong  integer;
  meta_next  jsonb;
BEGIN
  IF p_editor NOT IN ('teacher','revert') THEN RAISE EXCEPTION 'bad editor %', p_editor; END IF;
  IF jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty');
  END IF;
  SELECT id, teacher_id, meta INTO q FROM public.quizzes WHERE id = p_quiz_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF p_editor = 'teacher' AND q.teacher_id IS DISTINCT FROM p_teacher_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  v_now := COALESCE((q.meta->>'edit_v')::integer, 0);
  IF p_expect_v IS NOT NULL AND p_expect_v <> v_now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale', 'edit_v', v_now);
  END IF;
  -- Lock every question row: a child's answer insert needs FOR KEY SHARE on its row, so from here on none can land.
  PERFORM 1 FROM public.quiz_questions WHERE quiz_id = p_quiz_id ORDER BY id FOR UPDATE;
  SELECT count(*) INTO n_now FROM public.quiz_questions WHERE quiz_id = p_quiz_id;
  -- A child's answer: any sitting but the quiz's own teacher's preview (which carries their users.id) locks the quiz.
  SELECT EXISTS (
    SELECT 1 FROM public.quiz_answers a
    JOIN public.quiz_sessions s ON s.id = a.session_id
    JOIN public.quiz_questions qq ON qq.id = a.question_id
    WHERE qq.quiz_id = p_quiz_id AND s.user_id IS DISTINCT FROM q.teacher_id
  ) INTO answered;

  -- Check everything before writing anything.
  FOR c IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
    IF COALESCE((c->>'remove')::boolean, false) THEN
      IF p_editor = 'teacher' AND answered THEN RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'qid', c->>'id'); END IF;
      n_removed := n_removed + 1;
    END IF;
    SELECT * INTO r FROM public.quiz_questions WHERE id = (c->>'id')::uuid AND quiz_id = p_quiz_id;
    IF NOT FOUND THEN
      -- a revert puts a removed row back
      IF p_editor = 'revert' AND c ? 'insert' THEN CONTINUE; END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'stale', 'qid', c->>'id', 'edit_v', v_now);
    END IF;
    cur := jsonb_build_object(
      'question_text', r.question_text, 'option_a', r.option_a, 'option_b', r.option_b, 'option_c', r.option_c,
      'option_d', r.option_d, 'correct_option', r.correct_option, 'explanation', r.explanation,
      'misconception_feedback', r.misconception_feedback, 'distractor_misconceptions', r.distractor_misconceptions,
      'option_feedback', r.option_feedback, 'media', r.media);
    IF cur IS DISTINCT FROM (c->'before') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'stale', 'qid', c->>'id', 'edit_v', v_now);
    END IF;
    -- After a child answered: the words stay as the children read them. Only the key (and the feedback that named the
    -- old key, cleared with it) may change.
    IF p_editor = 'teacher' AND answered
       AND public.quiz_teacher_edit_words(c->'after') IS DISTINCT FROM public.quiz_teacher_edit_words(cur) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'qid', c->>'id');
    END IF;
  END LOOP;
  IF n_removed > 0 AND n_now - n_removed < p_min THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'floor', 'n', n_now, 'min', p_min);
  END IF;

  v_next := v_now + 1;
  FOR c IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
    IF COALESCE((c->>'remove')::boolean, false) THEN
      DELETE FROM public.quiz_questions WHERE id = (c->>'id')::uuid AND quiz_id = p_quiz_id;
    ELSIF p_editor = 'revert' AND c ? 'insert' THEN
      INSERT INTO public.quiz_questions SELECT * FROM jsonb_populate_record(NULL::public.quiz_questions, c->'insert')
        ON CONFLICT (id) DO NOTHING;
    ELSE
      r := jsonb_populate_record(NULL::public.quiz_questions, c->'after');
      UPDATE public.quiz_questions SET
        question_text = r.question_text, option_a = r.option_a, option_b = r.option_b, option_c = r.option_c,
        option_d = r.option_d, correct_option = r.correct_option, explanation = r.explanation,
        misconception_feedback = r.misconception_feedback, distractor_misconceptions = r.distractor_misconceptions,
        option_feedback = r.option_feedback, media = r.media
      WHERE id = (c->>'id')::uuid AND quiz_id = p_quiz_id;
      -- A key fix on an item children already answered goes on the review queue as fixed (counts as of now).
      IF p_editor = 'teacher' AND answered
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(c->'fields') x WHERE x->>'field' = 'key') THEN
        old_key := upper(COALESCE(c->'before'->'media'->'web'->>'key', c->'before'->>'correct_option'));
        new_key := upper(COALESCE(c->'after'->'media'->'web'->>'key', c->'after'->>'correct_option'));
        IF old_key ~ '^[A-D]$' THEN
          SELECT count(*)::integer AS n, count(*) FILTER (WHERE upper(a.selected_option) = new_key)::integer AS right_n
            INTO cnt
            FROM public.quiz_answers a JOIN public.quiz_sessions s ON s.id = a.session_id
            WHERE a.question_id = (c->>'id')::uuid AND s.user_id IS DISTINCT FROM q.teacher_id;
          SELECT COALESCE(max(z.k), 0)::integer INTO top_wrong FROM (
            SELECT count(*) AS k FROM public.quiz_answers a JOIN public.quiz_sessions s ON s.id = a.session_id
            WHERE a.question_id = (c->>'id')::uuid AND s.user_id IS DISTINCT FROM q.teacher_id AND upper(a.selected_option) <> new_key
            GROUP BY upper(a.selected_option)) z;
          INSERT INTO public.quiz_item_reviews (question_id, reason, status, key_at_flag, answers_n, top_wrong_n, right_n,
                                                first_flagged_on, last_seen_on, reviewed_at, reviewed_by, review_note)
          VALUES ((c->>'id')::uuid, 'teacher_edit', 'fixed', old_key, cnt.n, top_wrong, cnt.right_n,
                  (now() AT TIME ZONE 'Asia/Karachi')::date, (now() AT TIME ZONE 'Asia/Karachi')::date, now(), p_teacher_id,
                  left(format('teacher key fix %s -> %s (edit %s)', old_key, new_key, v_next), 500))
          ON CONFLICT (question_id, reason) DO UPDATE SET
            status = 'fixed', answers_n = EXCLUDED.answers_n, top_wrong_n = EXCLUDED.top_wrong_n, right_n = EXCLUDED.right_n,
            last_seen_on = EXCLUDED.last_seen_on, reviewed_at = EXCLUDED.reviewed_at, reviewed_by = EXCLUDED.reviewed_by,
            review_note = EXCLUDED.review_note;
          reviews := reviews + 1;
        END IF;
      END IF;
    END IF;
    FOR f IN SELECT * FROM jsonb_array_elements(COALESCE(c->'fields', '[]'::jsonb)) LOOP
      INSERT INTO public.quiz_teacher_edits (quiz_id, question_id, field, before, after, edited_by, edit_v, answered)
      VALUES (p_quiz_id, (c->>'id')::uuid, f->>'field', f->'before', f->'after', p_editor, v_next, answered);
    END LOOP;
  END LOOP;

  SELECT count(*) INTO n_now FROM public.quiz_questions WHERE quiz_id = p_quiz_id;
  meta_next := ((COALESCE(q.meta, '{}'::jsonb) - 'pdf_key') #- '{web,audio_v}' #- '{web_one,audio_v}')
    || jsonb_build_object('edit_v', v_next, 'question_count', n_now,
                          'teacher_edited', jsonb_build_object('at', now(), 'v', v_next, 'by', p_editor));
  UPDATE public.quizzes SET meta = meta_next WHERE id = p_quiz_id;
  RETURN jsonb_build_object('ok', true, 'edit_v', v_next, 'n', n_now, 'answered', answered, 'reviews', reviews);
END;
$$;
REVOKE ALL ON FUNCTION public.quiz_teacher_edit_apply(uuid, uuid, integer, jsonb, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_teacher_edit_apply(uuid, uuid, integer, jsonb, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.quiz_teacher_edit_pdf(p_quiz_id uuid, p_edit_v integer, p_pdf_key text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = public AS $$
  WITH u AS (
    UPDATE public.quizzes SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{pdf_key}', to_jsonb(p_pdf_key))
    WHERE id = p_quiz_id AND COALESCE((meta->>'edit_v')::integer, 0) = p_edit_v
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM u);
$$;
REVOKE ALL ON FUNCTION public.quiz_teacher_edit_pdf(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_teacher_edit_pdf(uuid, integer, text) TO service_role;
