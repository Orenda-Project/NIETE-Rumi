-- roster_change_class_details — a coach changes a saved class's grade, section
-- or shift from the saved-roster view of /roster, with the twin-class
-- refuse-or-merge.
--
-- WHY. Grade, section and shift ARE the class identity: classes is unique on
-- (school, grade, COALESCE(section,''), shift, session) WHERE is_active. A change
-- is therefore one of two things:
--
--   RENAME IN PLACE — the target identity is free. The row is updated and nothing
--   else moves, because children (class_enrollments), attendance history (via the
--   legacy list's class_id) and class_teachers all key on the class id. The legacy
--   mirrors' class_name is renamed to match, where the owner's unique name index
--   allows it.
--
--   COLLISION — an active class with the target identity already exists (13 such
--   twins are known on production: the same class scanned twice under two
--   spellings). This is NEVER merged silently. Without p_merge the function writes
--   nothing and answers 'collision' with the existing class id, its child count and
--   this class's count, so the screen can name it and ask. With p_merge it moves
--   every ACTIVE enrolment of the source into the existing class (a child already
--   in the target has her source enrolment CLOSED as a roster_correction — she is
--   the same child scanned twice, and closing is what the edit screen would do), a
--   roll the target already holds is dropped from the moved row rather than
--   refusing the child, the source's teachers keep a foothold on the target (never
--   as class teacher when the target has one), the source's mirrors are retired
--   (or, when the target has none, ONE of them is re-linked so attendance keeps a
--   list), and the source class is CLOSED with a reason: is_active = false and
--   merged_into_class_id = the target. Nothing is deleted anywhere.
--
-- SCHEMA (rule 15, live schema read on the sandbox before writing this): classes
-- has no column that can say "this class was folded into that one". The ledger
-- records who and when, but not into what — and a merged class with no pointer is
-- the twin problem in a new shape. ONE nullable column, no index, same pattern as
-- students.merged_into: merged_into_class_id.
--
-- LOCK. The SAME per-class advisory key as roster_import_students /
-- roster_apply_edits / roster_hand_over_class, taken on BOTH classes in id order
-- when merging so two coaches merging twins into each other cannot deadlock.
--
-- LEDGER. p_actor is the acting user, set into app.actor for the transaction so
-- record_history attributes every row this function changes to a real person.
--
-- Errors are VALUES: unknown_class, wrong_school, unknown_grade, unknown_section,
-- unknown_shift, missing_actor.

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS merged_into_class_id uuid REFERENCES public.classes(id);
COMMENT ON COLUMN public.classes.merged_into_class_id IS
  'Set when this class was closed by folding it into another (twin-class merge from /roster). '
  'is_active is false on such a row; its enrolments moved to the class named here. Never deleted.';

CREATE OR REPLACE FUNCTION public.roster_change_class_details(
  p_class_id uuid,
  p_school_id uuid,
  p_grade_code text,
  p_section text,
  p_shift_code text,
  p_actor uuid,
  p_merge boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class classes%ROWTYPE;
  v_target classes%ROWTYPE;
  v_section text;
  v_shift text;
  v_ordinal int;
  v_label text;
  v_target_label text;
  v_source_count int;
  v_target_count int;
  v_mirrors int := 0;
  v_moved int := 0;
  v_closed int := 0;
  v_teachers int := 0;
  v_target_list uuid;
  v_target_ct uuid;
  v_first uuid;
  v_second uuid;
BEGIN
  IF p_class_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'roster_change_class_details: p_class_id and p_actor are required';
  END IF;

  PERFORM set_config('app.actor', p_actor::text, true);
  PERFORM set_config('lock_timeout', '5000', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || p_class_id::text, 0));

  SELECT * INTO v_class FROM classes WHERE id = p_class_id AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'unknown_class'); END IF;
  IF p_school_id IS NOT NULL AND v_class.school_id <> p_school_id THEN
    RETURN jsonb_build_object('error', 'wrong_school');
  END IF;

  -- Vocabulary, exactly as createClass checks it: seeded grade, seeded section
  -- (normalised: upper, trimmed, NULL when blank), seeded shift.
  SELECT ordinal INTO v_ordinal FROM grade_levels WHERE code = p_grade_code AND is_active;
  IF v_ordinal IS NULL THEN RETURN jsonb_build_object('error', 'unknown_grade'); END IF;
  v_section := nullif(upper(btrim(coalesce(p_section, ''))), '');
  IF v_section IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sections WHERE code = v_section AND is_active) THEN
    RETURN jsonb_build_object('error', 'unknown_section');
  END IF;
  v_shift := coalesce(nullif(btrim(coalesce(p_shift_code, '')), ''), 'morning');
  IF NOT EXISTS (SELECT 1 FROM shifts WHERE code = v_shift AND is_active) THEN
    RETURN jsonb_build_object('error', 'unknown_shift');
  END IF;

  v_label := CASE WHEN v_ordinal = 0 THEN 'Early Years' ELSE 'Grade ' || v_ordinal END;
  IF v_section IS NOT NULL THEN v_label := v_label || ' - ' || v_section; END IF;
  IF v_shift <> 'morning' THEN v_label := v_label || ' (' || v_shift || ')'; END IF;

  IF v_class.grade_code = p_grade_code
     AND coalesce(v_class.section, '') = coalesce(v_section, '')
     AND v_class.shift_code = v_shift THEN
    RETURN jsonb_build_object('action', 'unchanged', 'class_id', p_class_id, 'label', v_label);
  END IF;

  SELECT count(*) INTO v_source_count FROM class_enrollments WHERE class_id = p_class_id AND is_active;

  SELECT * INTO v_target FROM classes
  WHERE school_id = v_class.school_id AND grade_code = p_grade_code
    AND coalesce(section, '') = coalesce(v_section, '')
    AND shift_code = v_shift AND session_code = v_class.session_code
    AND is_active AND id <> p_class_id
  LIMIT 1;

  -- ---------------------------------------------------------------- rename
  IF v_target.id IS NULL THEN
    UPDATE classes
    SET grade_code = p_grade_code, section = v_section, shift_code = v_shift, updated_at = now()
    WHERE id = p_class_id;

    -- The legacy lists follow the name, unless the owner already has an active
    -- list of that name in that year (the unique index would refuse it).
    UPDATE student_lists l
    SET class_name = v_label, section = v_section, updated_at = now()
    WHERE l.class_id = p_class_id AND l.is_active
      AND NOT EXISTS (SELECT 1 FROM student_lists o
                      WHERE o.user_id = l.user_id AND o.is_active AND o.id <> l.id
                        AND o.academic_year = l.academic_year
                        AND lower(o.class_name) = lower(v_label));
    GET DIAGNOSTICS v_mirrors = ROW_COUNT;

    RETURN jsonb_build_object('action', 'renamed', 'class_id', p_class_id, 'label', v_label,
      'mirrors_renamed', v_mirrors, 'source_count', v_source_count);
  END IF;

  -- ------------------------------------------------------------- collision
  SELECT count(*) INTO v_target_count FROM class_enrollments WHERE class_id = v_target.id AND is_active;
  v_target_label := v_label;

  IF NOT p_merge THEN
    RETURN jsonb_build_object('action', 'collision', 'class_id', p_class_id,
      'existing_class_id', v_target.id, 'existing_label', v_target_label,
      'existing_count', v_target_count, 'source_count', v_source_count);
  END IF;

  -- ----------------------------------------------------------------- merge
  -- Both classes locked, smaller id first, so two merges cannot deadlock.
  IF v_target.id < p_class_id THEN v_first := v_target.id; v_second := p_class_id;
  ELSE v_first := p_class_id; v_second := v_target.id; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || v_first::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || v_second::text, 0));

  -- A child already in the target: her source enrolment closes. She was scanned
  -- twice; closing is the correction, and it says so.
  UPDATE class_enrollments s
  SET is_active = false, left_on = current_date, outcome = 'roster_correction', updated_at = now()
  WHERE s.class_id = p_class_id AND s.is_active
    AND EXISTS (SELECT 1 FROM class_enrollments t
                WHERE t.class_id = v_target.id AND t.student_id = s.student_id AND t.is_active);
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  -- Everyone else moves. A roll the target already holds is dropped, not the child.
  UPDATE class_enrollments s
  SET class_id = v_target.id,
      roll_number = CASE WHEN s.roll_number IS NOT NULL AND EXISTS (
                      SELECT 1 FROM class_enrollments t
                      WHERE t.class_id = v_target.id AND t.is_active AND t.roll_number = s.roll_number)
                    THEN NULL ELSE s.roll_number END,
      updated_at = now()
  WHERE s.class_id = p_class_id AND s.is_active;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- The target's attendance list: its class teacher's, else any active one, else
  -- ONE of the source's is re-linked so the children keep a register.
  SELECT teacher_user_id INTO v_target_ct FROM class_teachers
  WHERE class_id = v_target.id AND is_active AND is_class_teacher LIMIT 1;
  SELECT id INTO v_target_list FROM student_lists
  WHERE class_id = v_target.id AND is_active
  ORDER BY (user_id = v_target_ct) DESC NULLS LAST, created_at
  LIMIT 1;
  IF v_target_list IS NULL THEN
    SELECT id INTO v_target_list FROM student_lists
    WHERE class_id = p_class_id AND is_active ORDER BY created_at LIMIT 1;
    IF v_target_list IS NOT NULL THEN
      UPDATE student_lists SET class_id = v_target.id, class_name = v_target_label, section = v_section, updated_at = now()
      WHERE id = v_target_list;
    END IF;
  END IF;

  -- The source's children follow the target's list; the source's other mirrors retire.
  IF v_target_list IS NOT NULL THEN
    UPDATE students st
    SET list_id = v_target_list, updated_at = now()
    FROM class_enrollments e
    WHERE e.class_id = v_target.id AND e.is_active AND e.student_id = st.id
      AND (st.list_id IS NULL OR st.list_id IN (SELECT id FROM student_lists WHERE class_id = p_class_id));
  END IF;
  UPDATE student_lists SET is_active = false, updated_at = now()
  WHERE class_id = p_class_id AND is_active AND id IS DISTINCT FROM v_target_list;
  UPDATE student_lists l
  SET student_count = (SELECT count(*) FROM students WHERE list_id = l.id AND is_active), updated_at = now()
  WHERE l.class_id IN (p_class_id, v_target.id) OR l.id = v_target_list;

  -- Teachers: a foothold on the target for each, never the class-teacher role
  -- when the target already has one; the source assignments close.
  INSERT INTO class_teachers (class_id, teacher_user_id, is_class_teacher, assigned_on, is_active)
  SELECT v_target.id, s.teacher_user_id,
         (v_target_ct IS NULL AND s.is_class_teacher), current_date, true
  FROM class_teachers s
  WHERE s.class_id = p_class_id AND s.is_active
    AND NOT EXISTS (SELECT 1 FROM class_teachers t
                    WHERE t.class_id = v_target.id AND t.teacher_user_id = s.teacher_user_id AND t.is_active);
  GET DIAGNOSTICS v_teachers = ROW_COUNT;
  UPDATE class_teachers
  SET is_active = false, is_class_teacher = false, ended_on = current_date, updated_at = now()
  WHERE class_id = p_class_id AND is_active;

  -- The source closes, and says where it went.
  UPDATE classes
  SET is_active = false, merged_into_class_id = v_target.id, updated_at = now()
  WHERE id = p_class_id;

  SELECT count(*) INTO v_target_count FROM class_enrollments WHERE class_id = v_target.id AND is_active;

  RETURN jsonb_build_object('action', 'merged', 'class_id', p_class_id,
    'target_class_id', v_target.id, 'label', v_target_label,
    'moved', v_moved, 'closed_duplicates', v_closed, 'teachers_moved', v_teachers,
    'target_count', v_target_count, 'target_list_id', v_target_list);
END;
$$;

REVOKE ALL ON FUNCTION public.roster_change_class_details(uuid, uuid, text, text, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_change_class_details(uuid, uuid, text, text, text, uuid, boolean)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- DOWN: DROP FUNCTION IF EXISTS public.roster_change_class_details(uuid, uuid, text, text, text, uuid, boolean);
--       (the column stays: it holds history — ALTER TABLE classes DROP COLUMN merged_into_class_id only if every row is NULL)
