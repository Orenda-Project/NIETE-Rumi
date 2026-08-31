-- roster_apply_edits — a coach corrects a SAVED roster (coach-requested, pre-prod).
--
-- Same discipline as roster_import_students, because an edit is the same hazard:
-- one transaction, serialized on the SAME per-class advisory lock (an edit racing
-- an import on one class is the exact concurrency shape that produced 460
-- duplicate children on launch day), idempotent on the edit-session run id.
--
-- The diff arrives pre-reconciled from the review screen:
--   p_updates [{id, student_name, father_name}]  name/father corrections
--   p_moves   [{id, roll}]                       roll corrections — the SAME child
--                                                moves; identity is never split
--   p_adds    [{roll, student_name, father_name}] children the register missed
--   p_removes [{id}]                             children not in this class
--
-- Removes CLOSE the enrolment — never DELETE (class_enrollments CASCADEs from
-- students; a delete would take attendance history with it). A removed child
-- left with no active enrolment anywhere is deactivated, not destroyed.

CREATE OR REPLACE FUNCTION public.roster_apply_edits(
  p_class_id uuid,
  p_run_id text,
  p_edited_by uuid,
  p_updates jsonb DEFAULT '[]'::jsonb,
  p_moves jsonb DEFAULT '[]'::jsonb,
  p_adds jsonb DEFAULT '[]'::jsonb,
  p_removes jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school uuid;
  v_list uuid;
  v_updated int := 0;
  v_moved int := 0;
  v_added int := 0;
  v_removed int := 0;
  v_deactivated int := 0;
BEGIN
  IF p_class_id IS NULL OR p_run_id IS NULL OR p_edited_by IS NULL THEN
    RAISE EXCEPTION 'roster_apply_edits: p_class_id, p_run_id and p_edited_by are required';
  END IF;

  PERFORM set_config('lock_timeout', '5000', true);
  -- THE SAME KEY as roster_import_students, deliberately.
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || p_class_id::text, 0));

  -- One edit session applies once. Adds are the non-idempotent part; the whole
  -- session short-circuits so a double-tapped Save is a clean replay.
  IF EXISTS (SELECT 1 FROM students WHERE import_run_id = p_run_id) THEN
    RETURN jsonb_build_object('updated', 0, 'moved', 0, 'added', 0, 'removed', 0, 'replay', true);
  END IF;

  SELECT school_id INTO v_school FROM classes WHERE id = p_class_id;
  SELECT id INTO v_list FROM student_lists
  WHERE class_id = p_class_id AND is_active ORDER BY created_at LIMIT 1;

  -- Corrections. Only children actually enrolled in THIS class can be touched.
  WITH u AS (
    SELECT (x->>'id')::uuid AS id,
           nullif(btrim(coalesce(x->>'student_name', '')), '') AS student_name,
           nullif(btrim(coalesce(x->>'father_name', '')), '') AS father_name
    FROM jsonb_array_elements(p_updates) AS t(x)
  )
  UPDATE students s
  SET student_name = coalesce(u.student_name, s.student_name),
      father_name = u.father_name,
      updated_at = now()
  FROM u
  WHERE s.id = u.id
    AND EXISTS (SELECT 1 FROM class_enrollments ce
                WHERE ce.class_id = p_class_id AND ce.student_id = s.id AND ce.is_active);
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Roll corrections: the SAME child moves. A roll already held by another
  -- active child is refused silently (the review screen shows the truth after).
  WITH m AS (
    SELECT (x->>'id')::uuid AS id,
           CASE WHEN coalesce(x->>'roll', '') ~ '^\d{1,3}$' THEN (x->>'roll')::int END AS roll
    FROM jsonb_array_elements(p_moves) AS t(x)
  ),
  moved AS (
    UPDATE class_enrollments ce
    SET roll_number = m.roll, updated_at = now()
    FROM m
    WHERE ce.class_id = p_class_id AND ce.student_id = m.id AND ce.is_active
      AND m.roll IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM class_enrollments o
                      WHERE o.class_id = p_class_id AND o.is_active
                        AND o.roll_number = m.roll AND o.student_id <> m.id)
    RETURNING ce.student_id, ce.roll_number
  )
  UPDATE students s
  SET roll_number = moved.roll_number, updated_at = now()
  FROM moved WHERE s.id = moved.student_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Children the register missed. Same insert shape as the import; a taken roll
  -- is refused rather than doubled (the layer-2 unique index will also refuse).
  WITH a AS (
    SELECT nullif(btrim(coalesce(x->>'student_name', '')), '') AS student_name,
           nullif(btrim(coalesce(x->>'father_name', '')), '') AS father_name,
           CASE WHEN coalesce(x->>'roll', '') ~ '^\d{1,3}$' THEN (x->>'roll')::int END AS roll
    FROM jsonb_array_elements(p_adds) AS t(x)
  ),
  ok AS (
    SELECT * FROM a
    WHERE a.student_name IS NOT NULL
      AND (a.roll IS NULL OR NOT EXISTS (
        SELECT 1 FROM class_enrollments o
        WHERE o.class_id = p_class_id AND o.is_active AND o.roll_number = a.roll))
  ),
  ins AS (
    INSERT INTO students
      (student_name, father_name, roll_number, list_id,
       enrolled_by_user_id, import_run_id, is_active, school_id)
    SELECT student_name, father_name, roll, v_list, p_edited_by, p_run_id, true, v_school
    FROM ok
    RETURNING id, roll_number
  )
  INSERT INTO class_enrollments (class_id, student_id, roll_number, enrolled_on, is_active)
  SELECT p_class_id, id, roll_number, current_date, true FROM ins
  ON CONFLICT (class_id, student_id) WHERE is_active DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  -- Not in this class: the enrolment closes. is_active = false, never DELETE.
  WITH r AS (SELECT (x->>'id')::uuid AS id FROM jsonb_array_elements(p_removes) AS t(x))
  UPDATE class_enrollments ce
  SET is_active = false, left_on = current_date, updated_at = now()
  FROM r
  WHERE ce.class_id = p_class_id AND ce.student_id = r.id AND ce.is_active;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- A removed child now enrolled nowhere was this roster's own creation (or
  -- unowned): deactivate the record so she stops appearing anywhere. Reversible.
  UPDATE students s
  SET is_active = false, status = 'inactive', updated_at = now()
  WHERE s.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_removes) AS t(x))
    AND NOT EXISTS (SELECT 1 FROM class_enrollments ce
                    WHERE ce.student_id = s.id AND ce.is_active)
    AND (s.list_id IS NULL OR v_list IS NULL OR s.list_id = v_list);
  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  IF v_list IS NOT NULL THEN
    UPDATE student_lists
    SET student_count = (SELECT count(*) FROM students
                         WHERE list_id = v_list AND is_active),
        updated_at = now()
    WHERE id = v_list;
  END IF;

  RETURN jsonb_build_object(
    'updated', v_updated, 'moved', v_moved, 'added', v_added,
    'removed', v_removed, 'deactivated', v_deactivated, 'replay', false);
END;
$$;

REVOKE ALL ON FUNCTION public.roster_apply_edits(uuid, text, uuid, jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_apply_edits(uuid, text, uuid, jsonb, jsonb, jsonb, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- DOWN: DROP FUNCTION IF EXISTS public.roster_apply_edits(uuid, text, uuid, jsonb, jsonb, jsonb, jsonb);
