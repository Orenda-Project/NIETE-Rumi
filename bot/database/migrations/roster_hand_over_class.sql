-- roster_hand_over_class — a coach names the class teacher of a class that is
-- already saved, from the saved-roster view of /roster.
--
-- WHY THIS EXISTS. A scan where the coach chose "Not listed" writes no
-- class_teachers row, and /class and /attendance list only classes a teacher is
-- assigned to — so the class is invisible to everyone. Measured on production
-- (15 Sep 2026): 19 such classes, 727 children. The only repair was to
-- photograph the register again. This function is the repair without the photo.
--
-- WHAT ONE HAND-OVER IS — all of it, or none of it, in ONE transaction:
--   1. her class_teachers row, is_class_teacher = true (the previous holder of
--      the role, if any, keeps their assignment but loses the flag: the partial
--      unique index allows one prime-responsible teacher per class);
--   2. her legacy attendance mirror (student_lists) — ADOPTED when she already
--      has an active list of the same name in the same year (the unique index
--      on (user_id, lower(class_name), academic_year) WHERE is_active would
--      otherwise refuse the insert), else written, and linked by class_id;
--   3. every child actively enrolled in the class repointed to HER list
--      (students.list_id is a single FK; attendance reads exactly that);
--   4. the fallback mirrors retired: the coach's/principal's (any leader role),
--      and the outgoing class teacher's. Attendance history keys on list_id and
--      the rows are deactivated, never deleted.
--
-- SCOPE. The class must be active and, when p_school_id is given, belong to
-- that school — the caller passes the school it is currently working in, so a
-- class id that arrived in a Flow payload cannot reach another school's roster.
-- The teacher must be a users row that is not a leader: a coach cannot be made
-- a class teacher through here.
--
-- LOCK. The SAME per-class advisory key as roster_import_students and
-- roster_apply_edits, so a hand-over cannot interleave with a save or an edit
-- of the same class.
--
-- LEDGER. `p_actor` is the acting user. It is set into `app.actor` for this
-- transaction so the row-history triggers (record_history.actor) attribute every
-- row this function changes to a real person rather than to the service role.
-- No audit table of its own: the ledger is record_history.
--
-- Errors are VALUES ('unknown_class', 'wrong_school', 'unknown_teacher',
-- 'not_a_teacher', 'unknown_grade') — the caller is a Flow endpoint that turns
-- them into a sentence on a screen.

CREATE OR REPLACE FUNCTION public.roster_hand_over_class(
  p_class_id uuid,
  p_school_id uuid,
  p_teacher_user_id uuid,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class classes%ROWTYPE;
  v_ordinal int;
  v_label text;
  v_role text;
  v_prev uuid;
  v_assignment uuid;
  v_list uuid;
  v_adopted boolean := false;
  v_adopted_from uuid;
  v_repointed int := 0;
  v_retired int := 0;
  v_already boolean := false;
BEGIN
  IF p_class_id IS NULL OR p_teacher_user_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'roster_hand_over_class: p_class_id, p_teacher_user_id and p_actor are required';
  END IF;

  -- Who is doing this, for the row-history ledger (transaction-local).
  PERFORM set_config('app.actor', p_actor::text, true);

  PERFORM set_config('lock_timeout', '5000', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || p_class_id::text, 0));

  SELECT * INTO v_class FROM classes WHERE id = p_class_id AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'unknown_class');
  END IF;
  IF p_school_id IS NOT NULL AND v_class.school_id <> p_school_id THEN
    RETURN jsonb_build_object('error', 'wrong_school');
  END IF;

  SELECT role INTO v_role FROM users WHERE id = p_teacher_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'unknown_teacher');
  END IF;
  IF v_role IN ('school_leader', 'supervisor', 'coach', 'principal', 'aeo') THEN
    RETURN jsonb_build_object('error', 'not_a_teacher');
  END IF;

  SELECT ordinal INTO v_ordinal FROM grade_levels WHERE code = v_class.grade_code;
  IF v_ordinal IS NULL THEN
    RETURN jsonb_build_object('error', 'unknown_grade');
  END IF;

  -- The legacy list name, exactly as ClassService.mirrorLabel writes it.
  v_label := CASE WHEN v_ordinal = 0 THEN 'Early Years' ELSE 'Grade ' || v_ordinal END;
  IF v_class.section IS NOT NULL THEN v_label := v_label || ' - ' || v_class.section; END IF;
  IF v_class.shift_code <> 'morning' THEN v_label := v_label || ' (' || v_class.shift_code || ')'; END IF;

  -- 1. The role. Whoever held it before keeps their assignment, loses the flag.
  SELECT teacher_user_id INTO v_prev FROM class_teachers
  WHERE class_id = p_class_id AND is_active AND is_class_teacher
    AND teacher_user_id <> p_teacher_user_id
  LIMIT 1;
  IF v_prev IS NOT NULL THEN
    UPDATE class_teachers SET is_class_teacher = false, updated_at = now()
    WHERE class_id = p_class_id AND teacher_user_id = v_prev AND is_active;
  END IF;

  SELECT id, is_class_teacher INTO v_assignment, v_already FROM class_teachers
  WHERE class_id = p_class_id AND teacher_user_id = p_teacher_user_id AND is_active
  LIMIT 1;
  IF v_assignment IS NULL THEN
    INSERT INTO class_teachers (class_id, teacher_user_id, is_class_teacher, assigned_on, is_active)
    VALUES (p_class_id, p_teacher_user_id, true, current_date, true)
    RETURNING id INTO v_assignment;
    v_already := false;
  ELSIF NOT v_already THEN
    UPDATE class_teachers SET is_class_teacher = true, updated_at = now() WHERE id = v_assignment;
  END IF;

  -- 2. Her mirror: linked already → same-name list adopted → else written.
  SELECT id INTO v_list FROM student_lists
  WHERE user_id = p_teacher_user_id AND class_id = p_class_id AND is_active
  ORDER BY created_at LIMIT 1;
  IF v_list IS NULL THEN
    SELECT id, class_id INTO v_list, v_adopted_from FROM student_lists
    WHERE user_id = p_teacher_user_id AND is_active
      AND academic_year = v_class.session_code
      AND lower(class_name) = lower(v_label)
    ORDER BY created_at LIMIT 1;
    IF v_list IS NOT NULL THEN
      UPDATE student_lists SET class_id = p_class_id, updated_at = now() WHERE id = v_list;
      v_adopted := true;
    ELSE
      INSERT INTO student_lists (user_id, class_name, section, academic_year, class_id, is_active)
      VALUES (p_teacher_user_id, v_label, v_class.section, v_class.session_code, p_class_id, true)
      RETURNING id INTO v_list;
    END IF;
  END IF;

  -- 3. The children follow her list.
  UPDATE students s
  SET list_id = v_list, updated_at = now()
  FROM class_enrollments e
  WHERE e.class_id = p_class_id AND e.is_active AND e.student_id = s.id
    AND s.list_id IS DISTINCT FROM v_list;
  GET DIAGNOSTICS v_repointed = ROW_COUNT;

  -- 4. The fallback mirrors retire: any leader's, and the outgoing class teacher's.
  UPDATE student_lists l
  SET is_active = false, updated_at = now()
  FROM users u
  WHERE l.class_id = p_class_id AND l.is_active AND l.id <> v_list
    AND u.id = l.user_id
    AND (u.role IN ('school_leader', 'supervisor', 'coach', 'principal', 'aeo')
         OR (v_prev IS NOT NULL AND u.id = v_prev));
  GET DIAGNOSTICS v_retired = ROW_COUNT;

  -- Counts from truth, on every list this touched.
  UPDATE student_lists l
  SET student_count = (SELECT count(*) FROM students WHERE list_id = l.id AND is_active),
      updated_at = now()
  WHERE l.id = v_list OR l.class_id = p_class_id;

  RETURN jsonb_build_object(
    'class_id', p_class_id,
    'teacher_user_id', p_teacher_user_id,
    'assignment_id', v_assignment,
    'already_class_teacher', v_already,
    'previous_class_teacher_user_id', v_prev,
    'list_id', v_list,
    'list_adopted', v_adopted,
    'list_adopted_from_class_id', v_adopted_from,
    'repointed', v_repointed,
    'retired_mirrors', v_retired,
    'label', v_label);
END;
$$;

REVOKE ALL ON FUNCTION public.roster_hand_over_class(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_hand_over_class(uuid, uuid, uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- DOWN: DROP FUNCTION IF EXISTS public.roster_hand_over_class(uuid, uuid, uuid, uuid);
