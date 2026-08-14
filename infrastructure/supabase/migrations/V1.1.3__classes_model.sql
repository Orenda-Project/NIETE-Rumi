-- V1.1.3 — Classes as a first-level entity.
--
-- WHAT IS WRONG TODAY. A "class" in this codebase is a row in `student_lists`,
-- a table created by the attendance feature (main-bot migration 014, Jan 2026)
-- for the sole purpose of holding a roster to mark attendance against. Class
-- identity was a side effect of a feature, so it inherited that feature's shape:
-- owned by ONE teacher, named by free text, with no school, no subject, no
-- session, and no notion of a student who exists independently of it.
--
-- Measured on production on 2026-08-14:
--
--     1  student_lists rows            465  schools
--    29  students                    8,797  users with school_id
--    21  of those with NO list_id    7,149  leader_teachers
--     1  attendance_sessions           433  leader_schools
--     8  attendance_records
--   943  quizzes — of which 0 carry a list_id
--
-- Two readings of those numbers, both decisive:
--
--   1. The roster model is UNUSED. 943 quizzes route around it entirely; 21 of
--      29 students are not in any list. Whatever it was for, the features that
--      should sit on a class are not sitting on it.
--
--   2. The institutional spine it should have hung off ALREADY EXISTS and is
--      fully populated — schools, users.school_id, users.role, leader_schools,
--      leader_teachers. `student_lists` simply never referenced any of it.
--
-- So class identity currently degrades into a string. The 21 rostered-nowhere
-- students carry 18 distinct spellings of what are really about three classes:
--   3 · 3b · 3c · 3-c · 3 C · Class:3 · Grade 3 · 4 · 4A · 4-A · 4 B · 4B
--   · ⁴ A · 5 · 5th A · class 5-c
-- (note the superscript ⁴ — free text collects everything.)
--
-- WHAT THIS MIGRATION DOES. Introduces the entity, with the real-world shape:
-- a class belongs to a SCHOOL, sits for a SESSION, is at one GRADE, and is
-- taught by one-or-more TEACHERS across one-or-more SUBJECTS, exactly one of
-- whom may be the prime-responsible class teacher. Students are enrolled into
-- it, rather than being rows inside it.
--
-- It does NOT migrate any feature. attendance / quizzes / reading keep reading
-- `student_lists` untouched; moving them across is a separate, sequenced PR.
-- Nothing here drops or alters an existing table.
--
-- WHY REFERENCE TABLES RATHER THAN CHECK CONSTRAINTS OR CODE CONSTANTS. Grade
-- and subject are keys here, not display strings, and prod holds four
-- incompatible grade encodings and five subject spellings:
--
--   grade   'PRIMARY'/'MIDDLE'/'HIGH' bands (5,503 users) · 'grade_N' slugs
--           (same column) · 'Grade One'…'Grade Five' words (62,000 LP catalog
--           rows) · 32 spellings of the 3 bands in leader_teachers.level,
--           typos included ('PRIMAYR', 'Parimary+HIGH+MIDDLE', 'Middle and High')
--   subject 'Math'/'Maths'/'maths' · 'Science'/'General Science'/'GK-Science'
--           · 'Islamiat'/'Islamic Studies'
--
-- A FK to a seeded table makes the canonical value unrepresentable-if-wrong and
-- gives the legacy encodings somewhere to resolve TO (the `aliases` arrays),
-- without touching the legacy columns now.
--
-- Rule-15 note — alternatives considered:
--
-- REJECTED  reusing `student_lists` with added columns. It is keyed on
--             (user_id, LOWER(class_name), academic_year) — teacher-owned by
--             construction. Making it school-owned changes its primary
--             identity, i.e. it is a new table wearing the old name, and every
--             existing consumer would silently change meaning.
--
-- REJECTED  `students.class_id` instead of an enrollment table. A class ends
--             with its session; students are then promoted (or retained into a
--             same-grade class in the NEXT session). With a pointer column,
--             every rollover duplicates the child. Enrollment-as-a-row makes
--             promotion a close+open and gives each child ONE identity with a
--             history. Confirmed with the operator 2026-08-14.
--
-- REJECTED  `academic_year TEXT` on classes (the main bot's shape, computed by
--             a hardcoded Apr–March function). The deployment must support
--             systems whose cycle is not a year — semesters and terms — so the
--             session is an entity with real start/end dates and a `kind`.
--             Operator, 2026-08-14.
--
-- REJECTED  name_en / name_ur columns on the reference tables. Field caps are
--             an outage class here (an 87-code-point footer against a 60 cap
--             took /language down silently for hours), and
--             .claude/scripts/language-audit.js measures caps by scanning
--             SOURCE. A label living in the database is invisible to it.
--             Selecting name_ur vs name_en at render time would also be a
--             second clamp implementation. Labels therefore go in
--             bot/shared/config/ux-strings.js keyed by these codes; the tables
--             hold identity and structure only. See the language-protocol skill.
--
-- REJECTED  a 6th subject vocabulary covering everything teachers teach. The
--             set is deliberately scoped to what the LP corpus can actually
--             serve (operator, 2026-08-14): a subject we cannot give a teacher
--             a lesson plan for earns no row yet. Adding one later is a
--             one-row INSERT, not a migration.
--
-- REJECTED  `students.school_id`. Derivable via class_enrollments → classes →
--             school_id. Rule 15(b).
--
-- Idempotent: every object is IF NOT EXISTS; every seed is ON CONFLICT DO
-- NOTHING. Re-running is a no-op.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. academic_sessions — the period a class sits for.
--
-- Duration-agnostic on purpose: `kind` + real dates, so a 6-month semester and
-- a 12-month annual session are the same entity with different spans. Named
-- `academic_sessions` and not `sessions` because eight *_sessions tables
-- already exist (coaching, quiz, chat, audio, byof, exam_check, pic_lp, audio)
-- and a bare `sessions` would read as one of those.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS academic_sessions (
    code        TEXT PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'annual'
                CHECK (kind IN ('annual', 'semester', 'term')),
    starts_on   DATE NOT NULL,
    ends_on     DATE NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT academic_sessions_span CHECK (ends_on > starts_on)
);

COMMENT ON TABLE academic_sessions IS
    'The period a class sits for. Duration-agnostic (annual / semester / term) '
    'so non-year academic systems are representable. A class ends with its session; '
    'students are then promoted or retained into a class in the NEXT session.';

-- Deliberately NOT an `is_current` flag: with mixed annual/semester schools,
-- more than one session can legitimately contain today. Current-ness is a date
-- predicate (now() BETWEEN starts_on AND ends_on), not stored state.
CREATE INDEX IF NOT EXISTS idx_academic_sessions_span
    ON academic_sessions (starts_on, ends_on) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 2. grade_levels — canonical grade, plus the band the legacy data speaks in.
--
-- `ordinal` is what makes "the next grade up" arithmetic rather than a lookup
-- table of successors (0 = pre-primary, 1..12). `band` carries the
-- PRIMARY/MIDDLE/HIGH vocabulary that registration and observation targeting
-- already use, so a band-only legacy value resolves to a SET of grades rather
-- than being silently coerced to one.
--
-- 13 rows, not the 12 in registration's GRADES_DROPDOWN: that dropdown collapses
-- 11 and 12 into a single `higher_secondary` option, which is fine for "what a
-- teacher teaches" but wrong for a class — a class sits at ONE grade. So 11 and
-- 12 are real rows here and `higher_secondary` is their shared band.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS grade_levels (
    code       TEXT PRIMARY KEY,
    ordinal    SMALLINT NOT NULL UNIQUE,
    band       TEXT NOT NULL
               CHECK (band IN ('early_years', 'primary', 'middle', 'high',
                               'higher_secondary')),
    aliases    TEXT[] NOT NULL DEFAULT '{}',
    sort_order SMALLINT NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON COLUMN grade_levels.aliases IS
    'Legacy spellings that resolve TO this grade — the "grade_N" slugs in '
    'users.grades_taught, the "Grade One".."Grade Five" words in '
    'lesson_plan_catalog (62k rows), and bare/ordinal digits. Band-only legacy '
    'values (PRIMARY/MIDDLE/HIGH) resolve to grade_levels.band, not here.';

CREATE INDEX IF NOT EXISTS idx_grade_levels_band ON grade_levels (band) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_grade_levels_aliases ON grade_levels USING GIN (aliases);

-- ---------------------------------------------------------------------------
-- 3. subjects — scoped to what the LP corpus can serve.
--
-- 6 codes: the 4 in lesson_plan_catalog (62,000 rows: English/Urdu/Math/General
-- Science) plus the 2 that appear only in pre_generated_lps (Social Studies,
-- General Knowledge — 25 rows). Deliberately EXCLUDED, though present in
-- registration's SUBJECTS_DROPDOWN or in quizzes: islamiat, computer_science,
-- geography, history, physics, chemistry, biology, other. A subject we cannot
-- serve a lesson plan for earns no row yet (operator, 2026-08-14).
--
-- CONSEQUENCE, stated so it is not discovered later: class_teacher_subjects can
-- therefore not yet express "teaches Islamiat to 4-A". Accepted. Note also that
-- registration's dropdown must NOT be regenerated from this table without a
-- separate decision — it would silently remove 5 options teachers currently pick.
--
-- `parent_code` exists for the grade-9+ science split (physics/chemistry/biology
-- → science) so an LP lookup can fall back to the parent. Unused by the seed.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subjects (
    code        TEXT PRIMARY KEY,
    parent_code TEXT REFERENCES subjects(code),
    aliases     TEXT[] NOT NULL DEFAULT '{}',
    sort_order  SMALLINT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON COLUMN subjects.aliases IS
    'The five competing spellings found in prod resolve here: Math/Maths/maths, '
    'Science/General Science/GK-Science, Islamiat/Islamic Studies, plus the '
    'programme labels Numeracy / Reading Hour Urdu / Reading Hour English.';

CREATE INDEX IF NOT EXISTS idx_subjects_aliases ON subjects USING GIN (aliases);

-- ---------------------------------------------------------------------------
-- 4. classes — the entity.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS classes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id          UUID NOT NULL REFERENCES schools(id),
    grade_code         TEXT NOT NULL REFERENCES grade_levels(code),
    section            TEXT,
    session_code       TEXT NOT NULL REFERENCES academic_sessions(code),
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id UUID REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Store sections normalized, so 'a' and 'A ' cannot become two classes.
    CONSTRAINT classes_section_normalized CHECK (
        section IS NULL
        OR (section = upper(btrim(section)) AND length(section) > 0)
    )
);

COMMENT ON TABLE classes IS
    'A class: one school, one grade, one section, one session. Session-scoped by '
    'construction — "4-A 2026-2027" and "4-A 2027-2028" are different rows, which '
    'is what makes promotion a pure enrollment operation.';

-- COALESCE on section is load-bearing: a plain UNIQUE would let unlimited
-- "Grade 4, no section" rows coexist, because NULLs do not conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_identity
    ON classes (school_id, grade_code, COALESCE(section, ''), session_code)
    WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_classes_school   ON classes (school_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_classes_session  ON classes (session_code) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 5. class_teachers — one row per (class, teacher). The ROLE lives here.
--
-- Shape driven by three real cases (operator, 2026-08-14):
--   several teachers on one class          → several rows, one class_id
--   one teacher, several subjects, 1 class → ONE row + N class_teacher_subjects
--   a dedicated prime-responsible teacher  → is_class_teacher, at most one
--
-- The role is on the pair and not on the subject row precisely because of case
-- two: a teacher taking Math AND Science for 4-A who is also its class teacher
-- would otherwise carry an ambiguous flag on two rows.
--
-- A class teacher with administrative responsibility but no teaching load is
-- representable: the subject rows are simply absent.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS class_teachers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id         UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    teacher_user_id  UUID NOT NULL REFERENCES users(id),
    is_class_teacher BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_on      DATE,
    ended_on         DATE,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_class_teachers_unique
    ON class_teachers (class_id, teacher_user_id) WHERE is_active;

-- At most ONE prime-responsible teacher per class. Not "exactly one": a class
-- may legitimately have none yet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_class_teacher_per_class
    ON class_teachers (class_id) WHERE is_class_teacher AND is_active;

CREATE INDEX IF NOT EXISTS idx_class_teachers_teacher
    ON class_teachers (teacher_user_id) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 6. class_teacher_subjects — which subjects one assignment covers.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS class_teacher_subjects (
    class_teacher_id UUID NOT NULL REFERENCES class_teachers(id) ON DELETE CASCADE,
    subject_code     TEXT NOT NULL REFERENCES subjects(code),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (class_teacher_id, subject_code)
);

CREATE INDEX IF NOT EXISTS idx_class_teacher_subjects_subject
    ON class_teacher_subjects (subject_code);

-- ---------------------------------------------------------------------------
-- 7. class_enrollments — membership, as a row with a date range.
--
-- This is what makes a child ONE person with a history instead of a row inside
-- a teacher's list. Promotion (later, not here) is: close the enrollment on the
-- old class, open one on the target class in the next session. Retention is the
-- SAME operation with a same-grade target — no flag, no special case.
--
-- `left_on` and `outcome` are nullable hooks left in deliberately: students
-- leave mid-year regardless, and having the columns now saves a migration when
-- promotion is built. No code reads `outcome` yet.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS class_enrollments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    roll_number  INTEGER,
    enrolled_on  DATE,
    left_on      DATE,
    outcome      TEXT CHECK (outcome IN ('promoted', 'retained', 'transferred',
                                         'left', 'completed')),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT class_enrollments_span CHECK (left_on IS NULL OR enrolled_on IS NULL
                                             OR left_on >= enrolled_on)
);

-- A child is enrolled in a given class once at a time; re-enrolment after
-- leaving is a new row, which is the history we want.
CREATE UNIQUE INDEX IF NOT EXISTS idx_class_enrollments_unique
    ON class_enrollments (class_id, student_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_class_enrollments_class
    ON class_enrollments (class_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_class_enrollments_student
    ON class_enrollments (student_id);

-- ---------------------------------------------------------------------------
-- 8. The bridge: student_lists.class_id
--
-- The new class CRUD becomes the single teacher-facing surface, and it MIRRORS
-- each new class into a `student_lists` row so attendance and the 943 existing
-- quizzes keep working with no change at all. This column is what links the two,
-- so the later cutover can find each legacy row's replacement instead of
-- matching on free text.
--
-- Deliberately nullable and un-backfilled: the one pre-existing student_lists row
-- predates any class and stays unlinked until someone claims it. The column, the
-- mirror write, and this comment all disappear in the cutover PR — it is
-- scaffolding, and naming it as such is how it avoids becoming permanent.
-- ---------------------------------------------------------------------------

ALTER TABLE student_lists
    ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id) ON DELETE SET NULL;

COMMENT ON COLUMN student_lists.class_id IS
    'TEMPORARY BRIDGE. Points at the `classes` row this legacy roster mirrors, so '
    'attendance/quizzes can keep reading student_lists until they are moved onto '
    'class_id directly. Removed together with the mirror write.';

CREATE INDEX IF NOT EXISTS idx_student_lists_class
    ON student_lists (class_id) WHERE class_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 9. RLS — mirrors the existing roster-table pattern (student_lists/students):
--     enable, and grant the service role full access. Portal scoping is done in
--     application code via dashboard_users / access_scopes, not here.
--
--     Deliberately NOT written against schools.principal_user_id: it is
--     populated on 0 of 465 rows and a pending change proposes dropping it.
-- ---------------------------------------------------------------------------

ALTER TABLE academic_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_levels           ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_teachers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_teacher_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_enrollments      ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'academic_sessions' AND policyname = 'service_role_academic_sessions') THEN
        CREATE POLICY "service_role_academic_sessions" ON academic_sessions FOR ALL USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'grade_levels' AND policyname = 'service_role_grade_levels') THEN
        CREATE POLICY "service_role_grade_levels" ON grade_levels FOR ALL USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subjects' AND policyname = 'service_role_subjects') THEN
        CREATE POLICY "service_role_subjects" ON subjects FOR ALL USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'classes' AND policyname = 'service_role_classes') THEN
        CREATE POLICY "service_role_classes" ON classes FOR ALL USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'class_teachers' AND policyname = 'service_role_class_teachers') THEN
        CREATE POLICY "service_role_class_teachers" ON class_teachers FOR ALL USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'class_teacher_subjects' AND policyname = 'service_role_class_teacher_subjects') THEN
        CREATE POLICY "service_role_class_teacher_subjects" ON class_teacher_subjects FOR ALL USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'class_enrollments' AND policyname = 'service_role_class_enrollments') THEN
        CREATE POLICY "service_role_class_enrollments" ON class_enrollments FOR ALL USING (auth.role() = 'service_role');
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 10. SEED — grade_levels (13).
--
-- Codes match registration's existing GRADES_DROPDOWN ids exactly, because
-- users.grades_taught is already populated with them; inventing new codes here
-- would strand 4,565 rows. grade_11 / grade_12 are the two additions.
-- ---------------------------------------------------------------------------

INSERT INTO grade_levels (code, ordinal, band, sort_order, aliases) VALUES
    ('early_years', 0,  'early_years',      0,  ARRAY['early_years','Early Years','Early Years (KG)','ECE','Katchi','Kachi','KG','Nursery','Prep','Montessori']),
    ('grade_1',     1,  'primary',          1,  ARRAY['grade_1','Grade 1','Grade One','1','1st']),
    ('grade_2',     2,  'primary',          2,  ARRAY['grade_2','Grade 2','Grade Two','2','2nd']),
    ('grade_3',     3,  'primary',          3,  ARRAY['grade_3','Grade 3','Grade Three','3','3rd']),
    ('grade_4',     4,  'primary',          4,  ARRAY['grade_4','Grade 4','Grade Four','4','4th']),
    ('grade_5',     5,  'primary',          5,  ARRAY['grade_5','Grade 5','Grade Five','5','5th']),
    ('grade_6',     6,  'middle',           6,  ARRAY['grade_6','Grade 6','Grade Six','6','6th']),
    ('grade_7',     7,  'middle',           7,  ARRAY['grade_7','Grade 7','Grade Seven','7','7th']),
    ('grade_8',     8,  'middle',           8,  ARRAY['grade_8','Grade 8','Grade Eight','8','8th']),
    ('grade_9',     9,  'high',             9,  ARRAY['grade_9','Grade 9','Grade Nine','9','9th']),
    ('grade_10',    10, 'high',             10, ARRAY['grade_10','Grade 10','Grade Ten','10','10th','Matric']),
    ('grade_11',    11, 'higher_secondary', 11, ARRAY['grade_11','Grade 11','Grade Eleven','11','11th','First Year','FSc I','Inter I']),
    ('grade_12',    12, 'higher_secondary', 12, ARRAY['grade_12','Grade 12','Grade Twelve','12','12th','Second Year','FSc II','Inter II'])
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. SEED — subjects (6). LP-corpus-scoped; see the note on the table.
-- ---------------------------------------------------------------------------

INSERT INTO subjects (code, sort_order, aliases) VALUES
    ('urdu',              1, ARRAY['urdu','Urdu','Reading Hour Urdu']),
    ('english',           2, ARRAY['english','English','Reading Hour English']),
    ('maths',             3, ARRAY['maths','Maths','Math','Mathematics','Numeracy']),
    ('science',           4, ARRAY['science','Science','General Science','general_science','GK-Science']),
    ('social_studies',    5, ARRAY['social_studies','Social Studies','Social Studies / Pak St.']),
    ('general_knowledge', 6, ARRAY['general_knowledge','General Knowledge','GK'])
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. SEED — academic_sessions.
--
-- Spans follow the AUGUST–JULY cycle this deployment already computes in
-- bot/shared/routes/attendance-setup-endpoint.js getCurrentAcademicYear(), which
-- rolls at getMonth() >= 7. Note this is NOT the main bot's April–March rule; a
-- test pins the two together so the table and that function cannot disagree on
-- which session today falls in. `kind = 'annual'`; a semester
-- deployment seeds its own rows and nothing here assumes a 12-month span.
--
-- 2026-2027 is seeded because it is the current session AND the value on the one
-- existing student_lists row, so a later backfill has a session to point at.
-- ---------------------------------------------------------------------------

INSERT INTO academic_sessions (code, kind, starts_on, ends_on) VALUES
    ('2025-2026', 'annual', DATE '2025-08-01', DATE '2026-07-31'),
    ('2026-2027', 'annual', DATE '2026-08-01', DATE '2027-07-31'),
    ('2027-2028', 'annual', DATE '2027-08-01', DATE '2028-07-31')
ON CONFLICT (code) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
