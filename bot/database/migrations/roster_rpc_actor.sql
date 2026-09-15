-- roster_rpc_actor — the two roster RPCs stamp the actor on their own transaction.
--
-- Bodies are BYTE-IDENTICAL to roster_apply_edits.sql and
-- roster_import_same_name_children.sql (both verified equal to the live prod
-- functions on 2026-09-15) plus ONE line each, directly after the lock_timeout:
--
--   PERFORM set_config('app.actor', p_edited_by::text, true);      -- roster_apply_edits
--   PERFORM set_config('app.actor', p_enrolled_by::text, true);    -- roster_import_students
--
-- WHY HERE AND NOT ONLY THE HEADER. The bot already sends `x-rumi-actor` on every
-- request made for a coach (row_history_actor.sql reads it), so through the bot
-- these lines are redundant — deliberately. They are for every OTHER way the RPC
-- gets called: a replay from the SQL editor, a backfill script, a future worker
-- that forgot the context. The uuid the caller hands us as "who edited" is the
-- same uuid it stamps on rows (students.enrolled_by_user_id), so the ledger and
-- the rows can never disagree about who.
--
-- WHY `true` (transaction-local). This is the transaction pooler (6543): a
-- session-level SET would ride the connection to the next unrelated request and
-- attribute a stranger's write to this coach. Local dies with the transaction.
--
-- Signatures unchanged: plain CREATE OR REPLACE, no DROP, no PostgREST dispatch
-- ambiguity, in-flight callers keep working across the deploy.

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
  -- bd-a21ks: the ledger names the coach. Transaction-local, so it is gone the
  -- moment this call ends and can never leak to the next borrower of a pooled
  -- connection. Wins over the x-rumi-actor header (same value from the bot) and
  -- holds even when this function is called from somewhere that sends no header.
  PERFORM set_config('app.actor', p_edited_by::text, true);
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
  --
  -- `outcome` says WHY, and the honest answer here is 'roster_correction': the coach
  -- struck a line off the register view and was never asked for a reason. It used to
  -- be left NULL, which records nothing; the JS writer used to say 'left', which
  -- records a departure nobody witnessed. Both are read by attrition analysis, one
  -- as a gap and one as a lie.
  WITH r AS (SELECT (x->>'id')::uuid AS id FROM jsonb_array_elements(p_removes) AS t(x))
  UPDATE class_enrollments ce
  SET is_active = false, left_on = current_date, outcome = 'roster_correction',
      updated_at = now()
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


CREATE OR REPLACE FUNCTION public.roster_import_students(
  p_class_id uuid,
  p_list_id uuid,
  p_run_id text,
  p_enrolled_by uuid,
  p_students jsonb,
  p_school_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_named int := 0;
  v_added int := 0;
BEGIN
  IF p_class_id IS NULL OR p_run_id IS NULL OR p_enrolled_by IS NULL THEN
    RAISE EXCEPTION 'roster_import_students: p_class_id, p_run_id and p_enrolled_by are required';
  END IF;

  PERFORM set_config('lock_timeout', '5000', true);
  -- bd-a21ks: the ledger names the coach (see roster_apply_edits).
  PERFORM set_config('app.actor', p_enrolled_by::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || p_class_id::text, 0));

  IF EXISTS (SELECT 1 FROM students WHERE import_run_id = p_run_id) THEN
    SELECT count(*) INTO v_named
    FROM jsonb_array_elements(p_students) AS t(x)
    WHERE btrim(coalesce(x->>'student_name', '')) <> '';
    RETURN jsonb_build_object('added', 0, 'skipped', coalesce(v_named, 0), 'replay', true);
  END IF;

  WITH named AS (
    SELECT
      btrim(x->>'student_name') AS student_name,
      nullif(btrim(coalesce(x->>'father_name', '')), '') AS father_name,
      nullif(btrim(coalesce(x->>'parent_phone', '')), '') AS parent_phone,
      nullif(btrim(coalesce(x->>'admission_no', '')), '') AS admission_no,
      CASE WHEN coalesce(x->>'date_of_birth', '') ~ '^\d{4}-\d{2}-\d{2}$'
           THEN (x->>'date_of_birth')::date END AS date_of_birth,
      CASE WHEN btrim(coalesce(x->>'roll_number', '')) ~ '^\d{1,3}$'
           THEN btrim(x->>'roll_number')::int END AS roll,
      ord
    FROM jsonb_array_elements(p_students) WITH ORDINALITY AS t(x, ord)
    WHERE btrim(coalesce(x->>'student_name', '')) <> ''
  ),
  -- TWO independent orderings, because a roll and a name mean different things.
  -- roll_rn is read only where the roll is present, so the NULLs sharing one
  -- partition below are never consulted.
  first_occurrence AS (
    SELECT n.*,
      row_number() OVER (PARTITION BY n.roll ORDER BY n.ord) AS roll_rn,
      row_number() OVER (PARTITION BY lower(n.student_name) ORDER BY n.ord) AS name_rn
    FROM named n
  ),
  existing AS (
    SELECT ce.roll_number, lower(btrim(s.student_name)) AS name_key
    FROM class_enrollments ce
    JOIN students s ON s.id = ce.student_id
    WHERE ce.class_id = p_class_id AND ce.is_active
  ),
  -- How many children of each name the class already holds. Evaluated once, before
  -- any insert in this statement, so the second same-name child of one payload
  -- cannot match the first one we are inserting alongside her.
  existing_names AS (
    SELECT e.name_key, count(*) AS held FROM existing e GROUP BY e.name_key
  ),
  fresh AS (
    SELECT f.ord, f.student_name, f.father_name, f.parent_phone,
           f.admission_no, f.date_of_birth, f.roll
    FROM first_occurrence f
    WHERE (
      (f.roll IS NOT NULL
        AND f.roll_rn = 1
        AND NOT EXISTS (SELECT 1 FROM existing e WHERE e.roll_number = f.roll))
      OR
      (f.roll IS NULL
        AND f.name_rn > coalesce(
          (SELECT n.held FROM existing_names n WHERE n.name_key = lower(f.student_name)), 0))
    )
  ),
  -- RECOGNITION: same school + same admission number = the same child. Unchanged.
  recognised AS (
    SELECT DISTINCT ON (f.ord) f.*, s.id AS existing_id
    FROM fresh f
    JOIN students s
      ON  p_school_id IS NOT NULL
      AND f.admission_no IS NOT NULL
      AND s.school_id = p_school_id
      AND s.admission_no = f.admission_no
      AND coalesce(s.status, 'active') = 'active'
      AND s.is_active
    ORDER BY f.ord, s.created_at
  ),
  recognised_new AS (
    SELECT r.* FROM recognised r
    WHERE NOT EXISTS (
      SELECT 1 FROM class_enrollments ce
      WHERE ce.class_id = p_class_id AND ce.student_id = r.existing_id AND ce.is_active)
  ),
  filled AS (
    UPDATE students s SET
      father_name   = coalesce(s.father_name, r.father_name),
      parent_phone  = coalesce(s.parent_phone, r.parent_phone),
      date_of_birth = coalesce(s.date_of_birth, r.date_of_birth),
      updated_at    = now()
    FROM recognised_new r
    WHERE s.id = r.existing_id
    RETURNING s.id
  ),
  to_create AS (
    SELECT f.* FROM fresh f
    WHERE NOT EXISTS (SELECT 1 FROM recognised r WHERE r.ord = f.ord)
  ),
  ins_students AS (
    INSERT INTO students
      (student_name, father_name, parent_phone, roll_number,
       list_id, enrolled_by_user_id, import_run_id, is_active,
       school_id, admission_no, date_of_birth)
    SELECT student_name, father_name, parent_phone, roll,
           p_list_id, p_enrolled_by, p_run_id, true,
           p_school_id, admission_no, date_of_birth
    FROM to_create
    RETURNING id, roll_number
  ),
  enrol_source AS (
    SELECT id, roll_number FROM ins_students
    UNION ALL
    SELECT existing_id AS id, roll AS roll_number FROM recognised_new
  ),
  ins_enrollments AS (
    INSERT INTO class_enrollments (class_id, student_id, roll_number, enrolled_on, is_active)
    SELECT p_class_id, id, roll_number, current_date, true
    FROM enrol_source
    ON CONFLICT (class_id, student_id) WHERE is_active DO NOTHING
    RETURNING id
  )
  SELECT (SELECT count(*) FROM named), (SELECT count(*) FROM ins_enrollments)
  INTO v_named, v_added;

  IF p_list_id IS NOT NULL THEN
    UPDATE student_lists
    SET student_count = (SELECT count(*) FROM students
                         WHERE list_id = p_list_id AND is_active),
        updated_at = now()
    WHERE id = p_list_id;
  END IF;

  RETURN jsonb_build_object(
    'added', coalesce(v_added, 0),
    'skipped', coalesce(v_named, 0) - coalesce(v_added, 0),
    'replay', false);
END;
$$;

REVOKE ALL ON FUNCTION public.roster_import_students(uuid, uuid, text, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_import_students(uuid, uuid, text, uuid, jsonb, uuid)
  TO service_role;

-- psql success is not PostgREST success.
NOTIFY pgrst, 'reload schema';

-- DOWN: re-apply the previous bodies — CREATE OR REPLACE from roster_apply_edits.sql
--       and roster_import_same_name_children.sql (same signatures, so no DROP is needed
--       and nothing else changes). Rows already stamped with an actor stay.
