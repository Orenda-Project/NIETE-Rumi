-- Migration: the one-shot handset link — one child across the WhatsApp chat quiz and the web page.
--
-- NON-DESTRUCTIVE. One SQL function and one partial index. No new column, no new table.
--
--   web_quiz_merge_student(p_from, p_to, p_actor)
--       Merges the page-made child p_from INTO the child p_to: every row that points at p_from
--       (every foreign key to students, enumerated LIVE from pg_constraint) is moved to p_to in
--       ONE transaction, the moved row ids are written to record_history (one row per table, so
--       the move can be undone by id), self-invites the move would create are nulled, and p_from
--       becomes a tombstone (status 'merged', merged_into p_to, inactive) — last, so its own
--       merged_into is not swept. Refuses (returns {refused}) when p_from has a class list, an
--       active enrolment, a sitting still in its window, a reading run still being scored, is
--       already merged, or equals p_to; and FAILS CLOSED when the live FK set holds a column this
--       function was not reviewed for (a new FK is reviewed before any merge runs). A unique-key
--       collision raises and rolls the whole merge back.
--       Callers: the bot's handset bind (app_settings web_quiz_handset_merge on) and the teacher's
--       fix-who. EXECUTE is revoked from PUBLIC/anon/authenticated and granted to service_role
--       (the repo's pattern: roster_apply_edits.sql), so it cannot be reached with the anon key.
--
--   quiz_sessions (device_ref)   the sittings a browser played (the bind reads them; the hub's
--       playedOn already filters on this column unindexed).
--
-- One env = one DB. Apply to sandbox first; staging and prod only on a go. On prod create the
-- index with web_quiz_handset_link_prod_index_concurrently.sql (outside a transaction) instead of
-- the CREATE INDEX below.

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_device_ref ON public.quiz_sessions (device_ref) WHERE device_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.web_quiz_merge_student(p_from uuid, p_to uuid, p_actor text DEFAULT 'web_quiz')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from students%ROWTYPE;
  v_to   students%ROWTYPE;
  v_fk   record;
  v_ids  text[];
  v_moved jsonb := '{}'::jsonb;
  v_n    int;
  -- Every FK column to students this function was reviewed for (live sandbox, 7 Oct 2026).
  v_known text[] := ARRAY[
    'attendance_records.student_id', 'class_enrollments.student_id', 'exam_submissions.student_id',
    'quiz_sessions.student_id', 'quiz_sessions.invited_by_student_id', 'quiz_share_codes.invited_by_student_id',
    'child_test_draws.student_id', 'child_test_sessions.student_id', 'web_quiz_challenge_runs.student_id',
    'students.merged_into'
  ];
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RETURN jsonb_build_object('refused', 'same_or_null');
  END IF;
  SELECT * INTO v_from FROM students WHERE id = p_from FOR UPDATE;
  SELECT * INTO v_to   FROM students WHERE id = p_to   FOR UPDATE;
  IF v_from.id IS NULL OR v_to.id IS NULL THEN RETURN jsonb_build_object('refused', 'unknown'); END IF;
  IF v_from.status = 'merged' OR v_to.status = 'merged' THEN RETURN jsonb_build_object('refused', 'already_merged'); END IF;
  IF v_from.list_id IS NOT NULL THEN RETURN jsonb_build_object('refused', 'listed'); END IF;
  IF EXISTS (SELECT 1 FROM class_enrollments WHERE student_id = p_from AND is_active) THEN
    RETURN jsonb_build_object('refused', 'enrolled');
  END IF;
  IF EXISTS (SELECT 1 FROM quiz_sessions WHERE student_id = p_from AND status = 'in_progress' AND expires_at > now()) THEN
    RETURN jsonb_build_object('refused', 'open_sitting');
  END IF;
  IF to_regclass('public.web_quiz_challenge_runs') IS NOT NULL AND EXISTS (
       SELECT 1 FROM web_quiz_challenge_runs WHERE student_id = p_from AND status = 'scoring' AND created_at > now() - interval '1 hour') THEN
    RETURN jsonb_build_object('refused', 'open_run');
  END IF;

  -- Fail closed on FK drift: a column this function was not reviewed for stops the merge.
  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.students'::regclass
  LOOP
    IF NOT (regexp_replace(v_fk.tbl, '^public\.', '') || '.' || v_fk.col) = ANY (v_known) THEN
      RAISE EXCEPTION 'web_quiz_merge_student: unreviewed FK %.% to students', v_fk.tbl, v_fk.col
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Move every live FK column, the tombstone's own merged_into excluded (set last, below).
  FOR v_fk IN
    SELECT regexp_replace(c.conrelid::regclass::text, '^public\.', '') AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.students'::regclass
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT array_agg(id::text) FROM %I WHERE %I = $1', v_fk.tbl, v_fk.col) INTO v_ids USING p_from;
    IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN CONTINUE; END IF;
    IF v_fk.tbl = 'students' AND v_fk.col = 'merged_into' THEN
      -- children already merged INTO p_from now point at p_to
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2 AND id <> $2', v_fk.tbl, v_fk.col, v_fk.col) USING p_to, p_from;
    ELSE
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', v_fk.tbl, v_fk.col, v_fk.col) USING p_to, p_from;
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_moved := v_moved || jsonb_build_object(v_fk.tbl || '.' || v_fk.col, to_jsonb(v_ids));
    -- record_history allows the row ops only (INSERT/UPDATE/DELETE): the merge is an UPDATE of the
    -- listed rows; `old_vals.merge = true` and the actor mark it as a merge move, undone by id.
    INSERT INTO record_history (table_name, row_id, op, changed_cols, old_vals, new_vals, actor, actor_source, txid, changed_at)
    VALUES (v_fk.tbl, p_from::text, 'UPDATE', ARRAY[v_fk.col],
            jsonb_build_object(v_fk.col, p_from, 'ids', to_jsonb(v_ids), 'merge', true),
            jsonb_build_object(v_fk.col, p_to, 'n', v_n),
            coalesce(p_actor, 'web_quiz'), 'sql', txid_current(), now());
  END LOOP;

  -- A child who "invited" themself after the move is nobody's friend.
  UPDATE quiz_sessions SET invited_by_student_id = NULL WHERE student_id = p_to AND invited_by_student_id = p_to;
  UPDATE quiz_share_codes c SET invited_by_student_id = NULL
    WHERE c.invited_by_student_id = p_to
      AND EXISTS (SELECT 1 FROM quiz_sessions s WHERE s.share_code_id = c.id AND s.student_id = p_to AND s.invited_by_student_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM quiz_sessions s WHERE s.share_code_id = c.id AND s.student_id <> p_to);

  -- The tombstone, last (students has its own history trigger).
  UPDATE students SET status = 'merged', merged_into = p_to, is_active = false, updated_at = now() WHERE id = p_from;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'moved', v_moved);
END;
$$;

REVOKE ALL ON FUNCTION public.web_quiz_merge_student(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.web_quiz_merge_student(uuid, uuid, text) TO service_role;
COMMENT ON FUNCTION public.web_quiz_merge_student(uuid, uuid, text) IS
  'web quiz: merge a page-made child into another child — every FK moved in one transaction, ids logged to record_history, tombstone last; service_role only';
