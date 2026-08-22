-- V1.1.4 — sections and shifts become vocabulary; a subject belongs to one teacher.
--
-- Three rules, all stated by the operator on 2026-08-14, and one bug they exposed.
--
-- RULE 1  SECTIONS ARE A CLOSED SET: A–E. A teacher needing another asks support,
--         who adds a row. That is precisely why this is a TABLE and not a CHECK —
--         "ask support" has to be cheap. A CHECK would make it a migration and a
--         deploy, so the answer would become "no" in practice.
--
-- RULE 2  SHIFT IS A NEW AXIS OF IDENTITY. Morning and Evening are different
--         classes: different students, different teachers, everything. So the
--         class identity becomes (school, grade, section, SHIFT, session), and
--         shift_code is NOT NULL — a nullable shift would mean "unspecified",
--         which is a third value that silently merges with neither.
--
-- RULE 3  ONE TEACHER PER SUBJECT PER CLASS. Two teachers could both be recorded
--         teaching Maths to 4-A. Enforcing this needs the class on the subject row
--         — the join table only knew the assignment — so class_id is denormalised
--         onto class_teacher_subjects to carry a real unique index rather than an
--         application-level check that races.
--
-- THE BUG THIS EXPOSED. The legacy roster mirror derives its class_name from the
-- GRADE alone ("Grade 9"), and student_lists is unique on
-- (user_id, LOWER(class_name), academic_year). So one teacher's "Grade 9 - A" and
-- "Grade 9 - B" collide on the mirror, and the second class silently ADOPTS the
-- first's roster. Adding shift would have made it worse — a morning and an evening
-- Grade 9 would collide too. Fixed in class.service.js, where the mirror label now
-- carries section and shift; recorded here because the cause is this schema.
--
-- Rule-15 note — alternatives considered:
--
-- REJECTED  a CHECK constraint for sections and shifts. See RULE 1: it makes
--             adding a section a deploy. The operator's stated preference is
--             tables and foreign keys over hardcoding, for exactly this reason.
--
-- REJECTED  per-school section vocabularies (school_sections). Correct in theory —
--             a section only means anything inside a school — but it needs 465
--             schools seeded before anyone can add a class, to solve a problem
--             (schools naming sections Blue/Green) nobody has reported. A global
--             A–E with support as the escape hatch is the smaller claim.
--
-- REJECTED  enforcing RULE 3 in application code only. Two teachers submitting at
--             once would both pass the check and both insert. A unique index
--             cannot be raced.
--
-- REJECTED  a composite FK from class_teacher_subjects to class_teachers so the
--             class could be reached without denormalising. It would still not let
--             a unique index span (class, subject) — an index needs the column on
--             the row it indexes.
--
-- KNOWN CONSEQUENCE, deliberately accepted: because uniqueness is on
-- (class_id, subject_code) and the join table carries no is_active of its own,
-- ENDING an assignment must DELETE its subject rows, or that subject stays locked
-- to a teacher who no longer teaches the class. There is no unassign path yet; the
-- one that gets built must do this. Noted in docs/classes-model.md.
--
-- Idempotent: every object is IF NOT EXISTS, every seed ON CONFLICT DO NOTHING,
-- and the destructive steps are all guarded. No explicit transaction commands —
-- see V1.1.3's header for why.

-- ---------------------------------------------------------------------------
-- 1. sections — A to E.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sections (
    code       TEXT PRIMARY KEY,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE sections IS
    'The closed set of section names a class may carry. A–E as seeded; support adds '
    'a row when a school needs another, which is why this is a table and not a CHECK. '
    'No display copy here — "A" renders as "A"; see the language-protocol skill for '
    'why labels live in the copy catalog.';

INSERT INTO sections (code, sort_order) VALUES
    ('A', 1), ('B', 2), ('C', 3), ('D', 4), ('E', 5)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. shifts — morning and evening.
--
-- Seeded BEFORE classes.shift_code is added, because that column defaults to
-- 'morning' and the default has to satisfy the foreign key on the way in.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shifts (
    code       TEXT PRIMARY KEY,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE shifts IS
    'A class sits in one shift. Morning and evening classes at the same school, '
    'grade and section are DIFFERENT classes with different students and teachers, '
    'which is why shift_code is part of the class identity index.';

INSERT INTO shifts (code, sort_order) VALUES
    ('morning', 1), ('evening', 2)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. classes.section becomes a foreign key.
--
-- Any pre-existing value outside the new vocabulary is set to NULL rather than
-- blocking the migration: a class whose section we cannot vouch for is better
-- recorded as unsectioned than as a value nothing can join to. NOTICE names them.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    stranded INTEGER;
BEGIN
    SELECT count(*) INTO stranded
    FROM classes c
    WHERE c.section IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sections s WHERE s.code = c.section);

    IF stranded > 0 THEN
        RAISE NOTICE 'V1.1.4: clearing % class section(s) outside the A-E vocabulary', stranded;
        UPDATE classes c
           SET section = NULL
         WHERE c.section IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM sections s WHERE s.code = c.section);
    END IF;
END$$;

-- The normalisation CHECK is superseded: the FK now permits only exactly 'A'..'E',
-- which is upper-case and unpadded by construction.
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_section_normalized;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'classes_section_fkey' AND table_name = 'classes'
    ) THEN
        ALTER TABLE classes
            ADD CONSTRAINT classes_section_fkey
            FOREIGN KEY (section) REFERENCES sections(code);
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 4. classes.shift_code, and the new identity.
-- ---------------------------------------------------------------------------

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS shift_code TEXT NOT NULL DEFAULT 'morning'
    REFERENCES shifts(code);

COMMENT ON COLUMN classes.shift_code IS
    'Which shift this class sits in. NOT NULL with a morning default because a '
    'nullable shift would be an "unspecified" third value that merges with neither '
    'morning nor evening. Part of the class identity index.';

CREATE INDEX IF NOT EXISTS idx_classes_shift ON classes (shift_code) WHERE is_active;

-- Identity now spans the shift. Dropped and rebuilt rather than added alongside,
-- so the OLD index cannot keep refusing a legitimate second shift.
DROP INDEX IF EXISTS idx_classes_identity;

CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_identity
    ON classes (school_id, grade_code, COALESCE(section, ''), shift_code, session_code)
    WHERE is_active;

-- ---------------------------------------------------------------------------
-- 5. One teacher per subject per class.
--
-- class_id is denormalised onto the join table because a unique index can only
-- span columns present on the row it indexes.
-- ---------------------------------------------------------------------------

ALTER TABLE class_teacher_subjects
    ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id) ON DELETE CASCADE;

UPDATE class_teacher_subjects cts
   SET class_id = ct.class_id
  FROM class_teachers ct
 WHERE ct.id = cts.class_teacher_id
   AND cts.class_id IS NULL;

-- Only tighten to NOT NULL if the backfill actually reached every row; an orphan
-- row (assignment deleted, subject row left) must not abort the whole migration.
DO $$
DECLARE
    orphans INTEGER;
BEGIN
    SELECT count(*) INTO orphans FROM class_teacher_subjects WHERE class_id IS NULL;
    IF orphans = 0 THEN
        BEGIN
            ALTER TABLE class_teacher_subjects ALTER COLUMN class_id SET NOT NULL;
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'V1.1.4: could not set class_id NOT NULL (%), leaving nullable', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'V1.1.4: % subject row(s) have no class_id; leaving column nullable', orphans;
    END IF;
END$$;

-- Deduplicate before the unique index, keeping the earliest claim on each
-- (class, subject). Without this the index creation fails on live data.
DO $$
DECLARE
    dupes INTEGER;
BEGIN
    WITH ranked AS (
        SELECT class_teacher_id, subject_code,
               ROW_NUMBER() OVER (
                   PARTITION BY class_id, subject_code
                   ORDER BY created_at ASC, class_teacher_id ASC
               ) AS rn
          FROM class_teacher_subjects
         WHERE class_id IS NOT NULL
    )
    DELETE FROM class_teacher_subjects cts
     USING ranked r
     WHERE cts.class_teacher_id = r.class_teacher_id
       AND cts.subject_code = r.subject_code
       AND r.rn > 1;

    GET DIAGNOSTICS dupes = ROW_COUNT;
    IF dupes > 0 THEN
        RAISE NOTICE 'V1.1.4: removed % duplicate subject claim(s), keeping the earliest', dupes;
    END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_teacher_per_class_subject
    ON class_teacher_subjects (class_id, subject_code)
    WHERE class_id IS NOT NULL;

COMMENT ON COLUMN class_teacher_subjects.class_id IS
    'Denormalised from class_teachers so (class_id, subject_code) can carry a unique '
    'index — one teacher per subject per class. CONSEQUENCE: ending an assignment '
    'must DELETE its subject rows, or that subject stays locked to a teacher who no '
    'longer teaches the class.';

NOTIFY pgrst, 'reload schema';
