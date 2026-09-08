-- roster_import_students v3 — TWO CHILDREN CAN SHARE A NAME.
--
-- WHY. On 2026-09-04 a coach photographed a Grade 2-A register at IMSB Dhoke Paracha.
-- The page has no roll-number column, so the extractor abstained on every roll — the
-- correct behaviour, because a guessed roll silently attaches a child to another
-- child's record. The coach was shown 23 names, two of them `Abdul Rehman`, and
-- changed nothing. The save wrote 22 and reported skipped=1.
--
-- v2 partitions on the roll where one exists and falls back to the NAME where it does
-- not. With every roll blank, the fallback IS the key, so the second Abdul Rehman was
-- read as a re-scan of the first and dropped. v1's own header already said why that is
-- wrong: "Real same-name children DO share one class (18 pairs measured inside single
-- reviewed registers), which is why name is only ever a fallback locator here and never
-- a unique key anywhere." On these registers the roll column is missing often enough
-- that the fallback is the common path, not the rare one.
--
-- THE RULE NOW. A roll is an IDENTITY: the first row carrying it wins, and a roll the
-- class already holds belongs to the child who holds it. A name is only a LOCATOR: the
-- Nth child of a name is new whenever the class holds fewer than N of that name
-- already. So two Abdul Rehmans on one page are two children; the same page scanned
-- again adds nobody, because by then the class holds two; and a third arriving later is
-- added rather than swallowed.
--
-- WHAT DOES NOT CHANGE. The per-class advisory lock, the run-id replay guard, the
-- single bulk transaction, and admission-number recognition are all untouched — those
-- are what ended the 460-child duplication of 2026-08-31 and none of it is relaxed
-- here. Signature is unchanged, so this is a plain CREATE OR REPLACE: no DROP, no
-- PostgREST dispatch ambiguity, and an in-flight caller keeps working across the deploy.
--
-- THE COST, STATED. A coach who photographs the SAME page twice inside one run now
-- saves each child twice instead of silently collapsing them. That is the right
-- trade: she approved the list on the review screen and can delete a line there,
-- whereas the child v2 dropped was invisible to her. The confirmation screen also
-- stops over-counting — it renders added+skipped, which claimed "23 students are on
-- the roster" on the very save that wrote 22.
--
-- Behavioural twin (keep in sync): tests/fixtures/fake-supabase.js rosterImportStudents.
-- Tests: tests/classes/import-roster.test.js "a register with no roll column".

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

-- DOWN: re-apply the v2 body from student_identity.sql (same signature, so a plain
--       CREATE OR REPLACE of that body reverts this with no drop).
