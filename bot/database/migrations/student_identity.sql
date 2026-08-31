-- student_identity — the child becomes a first-class entity of the platform.
--
-- Three different things, and the distinction IS the design:
--   students.id    the IDENTITY. Permanent, internal, everything FKs to it.
--   student_code   the HUMAN HANDLE. Ours ("S-100234"), unique, exists even when
--                  the register gave us nothing to go on.
--   admission_no   a RECOGNITION attribute. The school's own permanent number,
--                  printed on most registers — but sometimes blank, and once
--                  measured written in the WRONG printed column — so it helps a
--                  re-scan find an existing child and is never the identity.
--
-- The child is anchored to a SCHOOL (admission numbers are school-issued; the
-- school is the one stable scope), and to classes only through dated
-- enrolments. Nothing here keys on a name: 18 same-name pairs were measured
-- inside single coach-reviewed registers.
--
-- The recognition UNIQUE index (school_id, admission_no) does NOT ship here —
-- it ships after the backfill and a duplicate sweep prove the data clean.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id),
  ADD COLUMN IF NOT EXISTS admission_no text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','merged')),
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES students(id);

CREATE SEQUENCE IF NOT EXISTS student_code_seq START 100000;
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_code text;

-- Every existing child gets her handle. Volatile defaults do not backfill, so:
UPDATE students SET student_code = 'S-' || nextval('student_code_seq')
WHERE student_code IS NULL;
ALTER TABLE students ALTER COLUMN student_code
  SET DEFAULT 'S-' || nextval('student_code_seq');
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_code ON students (student_code);

-- school_id backfill, both ownership paths:
-- 1. the canonical one — an active enrolment names a class, the class a school
UPDATE students s SET school_id = c.school_id
FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id
WHERE ce.student_id = s.id AND ce.is_active AND s.school_id IS NULL;
-- 2. the legacy one — the list's owner is a teacher with a school
UPDATE students s SET school_id = u.school_id
FROM student_lists sl JOIN users u ON u.id = sl.user_id
WHERE s.list_id = sl.id AND s.school_id IS NULL AND u.school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_students_school
  ON students (school_id) WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_school_admission_lookup
  ON students (school_id, admission_no)
  WHERE school_id IS NOT NULL AND admission_no IS NOT NULL;

-- ---------------------------------------------------------------------------
-- roster_import_students v2 — same guarantees (serialized, idempotent, bulk),
-- now RECOGNISING: an incoming row whose (school, admission_no) matches an
-- active child anywhere in the school is the SAME child — she is enrolled into
-- this class and her blanks are filled; she is never duplicated and never
-- overwritten. Signature change = drop + recreate (two overloads would make
-- PostgREST's rpc dispatch ambiguous); p_school_id has a DEFAULT so the v1
-- caller keeps working during the deploy window.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.roster_import_students(uuid, uuid, text, uuid, jsonb);

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
  first_occurrence AS (
    SELECT n.*, row_number() OVER (
      PARTITION BY CASE WHEN n.roll IS NOT NULL THEN 'r:' || n.roll::text
                        ELSE 'n:' || lower(n.student_name) END
      ORDER BY n.ord) AS rn
    FROM named n
  ),
  existing AS (
    SELECT ce.roll_number, lower(btrim(s.student_name)) AS name_key
    FROM class_enrollments ce
    JOIN students s ON s.id = ce.student_id
    WHERE ce.class_id = p_class_id AND ce.is_active
  ),
  fresh AS (
    SELECT f.ord, f.student_name, f.father_name, f.parent_phone,
           f.admission_no, f.date_of_birth, f.roll
    FROM first_occurrence f
    WHERE f.rn = 1
      AND NOT (f.roll IS NOT NULL AND EXISTS (
        SELECT 1 FROM existing e WHERE e.roll_number = f.roll))
      AND NOT (f.roll IS NULL AND EXISTS (
        SELECT 1 FROM existing e WHERE e.name_key = lower(f.student_name)))
  ),
  -- RECOGNITION: same school + same admission number = the same child.
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
    -- fill blanks only; NEVER overwrite what the record already carries
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

NOTIFY pgrst, 'reload schema';

-- DOWN:
--   DROP FUNCTION IF EXISTS public.roster_import_students(uuid, uuid, text, uuid, jsonb, uuid);
--   (recreate the 5-arg version from roster_import_students.sql)
--   DROP INDEX IF EXISTS idx_students_school_admission_lookup;
--   DROP INDEX IF EXISTS idx_students_school;
--   DROP INDEX IF EXISTS idx_students_code;
--   ALTER TABLE students DROP COLUMN IF EXISTS merged_into, DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS student_code, DROP COLUMN IF EXISTS date_of_birth,
--     DROP COLUMN IF EXISTS admission_no, DROP COLUMN IF EXISTS school_id;
--   DROP SEQUENCE IF EXISTS student_code_seq;
