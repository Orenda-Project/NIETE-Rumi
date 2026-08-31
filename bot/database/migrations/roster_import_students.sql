-- roster_import_students — the /roster bulk write as ONE database function.
--
-- WHY. On its first live day (2026-08-31) /roster duplicated 460 children across
-- 24 classes. The save was 2N sequential round-trips (25-38s for a real class),
-- coaches pressed Save again while the first press was still running, and each
-- pass read the class before any other pass had committed — so the in-code
-- dedupe saw an empty class every time. A concurrency bug between two server
-- instances cannot be fixed in JS; only the database can serialize the writers.
--
-- Three guarantees, in one transaction:
--   1. SERIALIZED  — pg_advisory_xact_lock per class. Two saves on one class run
--      one after the other; saves on different classes stay parallel.
--   2. IDEMPOTENT  — a run id writes at most once, EVER. The second press waits
--      on the lock, then finds its own run already applied and replays the
--      answer instead of the insert.
--   3. FAST        — two bulk INSERT..SELECTs instead of 2N round-trips, so the
--      save answers inside Meta's ~10s budget and the second press mostly
--      never happens.
--
-- Payload contract (mirrored by tests/fixtures/fake-supabase.js — keep in sync):
--   p_students: jsonb array of {roll_number, student_name, father_name, parent_phone}
--   returns   : {added int, skipped int, replay bool}
-- Dedupe parity with the launch JS: within the payload the first occurrence of a
-- roll (or of a name, where the register carried no roll) wins; against the
-- committed class, a roll-bearing child is matched on roll, a roll-less child on
-- name. Real same-name children DO share one class (18 pairs measured inside
-- single reviewed registers), which is why name is only ever a fallback locator
-- here and never a unique key anywhere.

-- Provenance: which /roster run created this row. NULL for every other writer.
ALTER TABLE students ADD COLUMN IF NOT EXISTS import_run_id text;
CREATE INDEX IF NOT EXISTS idx_students_import_run
  ON students (import_run_id) WHERE import_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.roster_import_students(
  p_class_id uuid,
  p_list_id uuid,
  p_run_id text,
  p_enrolled_by uuid,
  p_students jsonb
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

  -- Wait at most 5s for another save on this class. PostgREST's statement
  -- timeout is ~8s, so we surface 55P03 (the caller maps it to an honest
  -- "already being saved" screen) rather than being killed opaquely.
  PERFORM set_config('lock_timeout', '5000', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || p_class_id::text, 0));

  -- The run key. The second press serialized behind the first on the lock
  -- above; by the time it gets here, its own run is already applied.
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
    SELECT f.student_name, f.father_name, f.parent_phone, f.roll
    FROM first_occurrence f
    WHERE f.rn = 1
      AND NOT (f.roll IS NOT NULL AND EXISTS (
        SELECT 1 FROM existing e WHERE e.roll_number = f.roll))
      AND NOT (f.roll IS NULL AND EXISTS (
        SELECT 1 FROM existing e WHERE e.name_key = lower(f.student_name)))
  ),
  ins_students AS (
    INSERT INTO students
      (student_name, father_name, parent_phone, roll_number,
       list_id, enrolled_by_user_id, import_run_id, is_active)
    SELECT student_name, father_name, parent_phone, roll,
           p_list_id, p_enrolled_by, p_run_id, true
    FROM fresh
    RETURNING id, roll_number
  ),
  ins_enrollments AS (
    -- The partial unique idx_class_enrollments_unique backs this: even if a
    -- future edit breaks the dedupe above, the same child cannot be enrolled
    -- in one class twice.
    INSERT INTO class_enrollments (class_id, student_id, roll_number, enrolled_on, is_active)
    SELECT p_class_id, id, roll_number, current_date, true
    FROM ins_students
    ON CONFLICT (class_id, student_id) WHERE is_active DO NOTHING
    RETURNING id
  )
  SELECT (SELECT count(*) FROM named), (SELECT count(*) FROM ins_enrollments)
  INTO v_named, v_added;

  -- The legacy mirror count this write just changed. Set from truth, not by
  -- increment — it was measured wrong on 39 of 60 lists precisely because
  -- writers incremented instead of counting.
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

-- A PUBLIC-executable SECURITY DEFINER function is an open door. Bot traffic
-- arrives as service_role; nobody else has business calling this.
REVOKE ALL ON FUNCTION public.roster_import_students(uuid, uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_import_students(uuid, uuid, text, uuid, jsonb)
  TO service_role;

-- psql success is not PostgREST success.
NOTIFY pgrst, 'reload schema';

-- DOWN:
--   DROP FUNCTION IF EXISTS public.roster_import_students(uuid, uuid, text, uuid, jsonb);
--   DROP INDEX IF EXISTS idx_students_import_run;
--   ALTER TABLE students DROP COLUMN IF EXISTS import_run_id;
