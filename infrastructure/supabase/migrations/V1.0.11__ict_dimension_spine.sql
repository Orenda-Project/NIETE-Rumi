-- V1.0.11  ICT dimension spine (regions / schools / coach + teacher profiles / FICO KPIs)
--
-- Companion to V1.0.5, which imported the coaching-observation FACTS but not the
-- lookups they point at. V1.0.5 preserved the Django FK columns as *opaque* BIGINTs
-- (`observations.coach_id`, `teacher_visits.teacher_id`, `school_visits.school_id`)
-- with the note that "consumers who need the user identity join via other paths".
-- There was no such path: no region, school, coach-profile or teacher-profile table
-- was ever migrated, so "which coach observed which teacher, at which school, in
-- which sector" is answerable at source and unanswerable here.
--
-- This migration lands the five lookups and makes those opaque columns resolvable.
--
-- Design notes (mirroring V1.0.5's conventions):
--   * PK = source id (BIGINT on all five — these are Django integer PKs, unlike the
--     UUID-keyed fact tables). Matches the opaque BIGINT columns in V1.0.5 exactly,
--     so no ID remapping is needed.
--   * `source_system` = 'fde_production' constant on every row for provenance.
--   * `migrated_at` timestamptz default now() for audit / re-run detection.
--   * Soft-deleted (`deleted_at IS NOT NULL`) and test-account source rows are
--     EXCLUDED at migration-script level, not here — this schema mirrors the source
--     shape faithfully (same split as V1.0.5).
--   * `fico_kpis` deliberately carries NO HR/PII columns; see its comment below.
--
-- Additive: no existing row is written or deleted, no existing column is dropped,
-- renamed or retyped. The three FK back-fills at the end are ADD CONSTRAINT ...
-- NOT VALID, so existing rows are never re-checked and legacy data cannot block the
-- migration.
--
-- Shared DB: one Postgres serves prod/staging/QA. Applying this is a global act;
-- every statement is IF NOT EXISTS / guarded, so re-running is a no-op.
--
-- Source schema verified live 2026-08-04 (get_table_schema against tbproddb).
-- Validated end-to-end against PostgreSQL 16 on 2026-08-04: apply, re-apply,
-- FK guards, view tie-break, and the DOWN block. See docs/migration/.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. school_regions -- the six ICT sectors (+ Durbeen). 7 rows.
--    Source: schools_schoolregion
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nietemigrated_school_regions (
    id             BIGINT PRIMARY KEY,          -- schools_schoolregion.id
    name           TEXT NOT NULL,               -- 'B.K', 'Nilore', 'Urban-I', ...
    is_active      BOOLEAN,
    created        TIMESTAMPTZ,
    modified       TIMESTAMPTZ,
    source_system  TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE nietemigrated_school_regions IS
  'ICT sectors, mirrored from fde_production.schools_schoolregion. Vocabulary is '
  'abbreviated/hyphenated: B.K, Nilore, Sihala, Tarnol, Urban-I, Urban-II, Durbeen. '
  'A filter for ''Bhara Kahu'' or ''Urban 1'' matches nothing.';

-- ---------------------------------------------------------------------------
-- 2. schools -- 462 live rows (deleted_at IS NULL), 459 distinct EMIS.
--    Source: schools_school LEFT JOIN schools_schoolregion
--    region_name is denormalized so the common sector rollup is a single-table read.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nietemigrated_schools (
    id             BIGINT PRIMARY KEY,          -- schools_school.id
    uuid           UUID,
    name           TEXT NOT NULL,
    emis           INTEGER,                     -- NULL on 3 rows; NOT unique
    region_id      BIGINT REFERENCES nietemigrated_school_regions(id),
    region_name    TEXT,                        -- denormalized sector
    city           TEXT,
    is_active      BOOLEAN,
    created        TIMESTAMPTZ,
    modified       TIMESTAMPTZ,
    source_system  TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- emis is NOT UNIQUE: 462 live schools carry 459 distinct EMIS (verified
-- 2026-08-04), so a unique constraint would reject the load.
CREATE INDEX IF NOT EXISTS idx_nm_schools_region ON nietemigrated_schools(region_id);
CREATE INDEX IF NOT EXISTS idx_nm_schools_emis   ON nietemigrated_schools(emis);
CREATE INDEX IF NOT EXISTS idx_nm_schools_rname  ON nietemigrated_schools(region_name);

COMMENT ON COLUMN nietemigrated_schools.emis IS
  'School EMIS. NULL on 3 rows and non-unique (459 distinct across 462 schools, '
  '2026-08-04). ICT EMIS is a 3-digit integer (203-926) and does NOT join to the '
  '7-8 digit Punjab EMIS codes in aeo_schools / leader_schools.';

COMMENT ON COLUMN nietemigrated_schools.region_name IS
  'Denormalized copy of school_regions.name. NULL for the ~32 schools with no '
  'region -- unfilterable by sector, and must be surfaced rather than hidden.';

-- ---------------------------------------------------------------------------
-- 3. coach_profiles -- 117 rows; 63 have observations.
--    Source: users_coachprofile JOIN users_user (org 1, non-test, not deleted)
--    id resolves V1.0.5's opaque observations.coach_id / teacher_visits.coach_id,
--    and user_profile_object_id where user_profile_content_type_id = 173.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nietemigrated_coach_profiles (
    id             BIGINT PRIMARY KEY,          -- users_coachprofile.id
    user_id        BIGINT,                      -- users_user.id
    coach_name     TEXT,
    phone_number   TEXT,                        -- users_user.username
    is_active      BOOLEAN,
    created        TIMESTAMPTZ,
    modified       TIMESTAMPTZ,
    source_system  TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nm_coach_user ON nietemigrated_coach_profiles(user_id);

COMMENT ON TABLE nietemigrated_coach_profiles IS
  'Coach PROFILE ids (users_coachprofile.id), not user ids -- the join target for '
  'the opaque coach_id columns V1.0.5 preserved. migrate-users.py imported coaches '
  'as people into users but did not keep this id, which is why observations could '
  'not resolve their coach before this migration.';

-- ---------------------------------------------------------------------------
-- 4. teacher_profiles -- 4,310 rows / 4,259 distinct teachers.
--    Source: users_teacherprofile JOIN users_user (org 1, active, non-test, not deleted)
--    id resolves V1.0.5's opaque teacher_visits.teacher_id.
--    Rows exceed people because a transferred teacher holds one profile row per
--    school assignment (51 teachers hold 2, verified 2026-08-04).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nietemigrated_teacher_profiles (
    id             BIGINT PRIMARY KEY,          -- users_teacherprofile.id
    user_id        BIGINT NOT NULL,             -- users_user.id -- NOT unique here
    teacher_name   TEXT,
    phone_number   TEXT,                        -- users_user.username
    school_id      BIGINT REFERENCES nietemigrated_schools(id),
    levels         TEXT,                        -- e.g. "['PRIMARY', 'MIDDLE']"
    is_active      BOOLEAN,
    created        TIMESTAMPTZ,
    modified       TIMESTAMPTZ,
    source_system  TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nm_teacher_school ON nietemigrated_teacher_profiles(school_id);
CREATE INDEX IF NOT EXISTS idx_nm_teacher_user   ON nietemigrated_teacher_profiles(user_id);

COMMENT ON TABLE nietemigrated_teacher_profiles IS
  'Teacher PROFILE ids (users_teacherprofile.id) -- the join target for V1.0.5''s '
  'opaque teacher_visits.teacher_id. One row per (teacher x school assignment): '
  '4,310 rows for 4,259 people. ALWAYS COUNT(DISTINCT user_id) for a headcount.';

COMMENT ON COLUMN nietemigrated_teacher_profiles.levels IS
  'Single-quoted stringified list of PRIMARY / MIDDLE / HIGH. There is NO '
  '''SECONDARY'' value in the data -- "secondary" means MIDDLE. Match with '
  'ILIKE ''%MIDDLE%''. Level counts OVERLAP (one teacher can teach two levels), so '
  'they must never be summed into a total.';

-- ---------------------------------------------------------------------------
-- 5. fico_kpis -- 5,180 rows. Six KPIs scored 0-10, plus total and percentage.
--    Source: fico_kpis (28 columns at source; 13 mirrored)
--
--    DELIBERATELY NOT MIRRORED:
--      * 9 HR columns (cnic, date_of_birth, gender, joining_date,
--        last_promotion_date, qualifications, professional_trainings,
--        service_designation, basic_pay_scale). HR records, not dashboard metrics.
--        Not migrating PII is stronger than migrating it behind a read-side
--        allow-list: there is no column to leak and no tier rule to enforce.
--      * teacher_name / School / Sector / levels / contact_number -- these repeat
--        identically on every observation of the same teacher; read them from
--        teacher_profiles through the view below.
--    emis is the ONE placement column kept, as the join tie-breaker.
--
--    No id column at source, so the PK is the observation grain. Same teacher, same
--    day, two subjects = two legitimate rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nietemigrated_fico_kpis (
    user_id                   BIGINT NOT NULL,  -- users_user.id (NOT a profile id)
    observation_date          DATE NOT NULL,
    grade                     TEXT NOT NULL DEFAULT '',
    subject                   TEXT NOT NULL DEFAULT '',
    emis                      INTEGER,          -- join tie-breaker, see the view
    -- the six scored KPIs, each 0-10
    planning_and_preparation  DOUBLE PRECISION,
    subject_knowledge         DOUBLE PRECISION,
    classroom_management      DOUBLE PRECISION,
    communication_skills      DOUBLE PRECISION,
    professional_development  DOUBLE PRECISION,
    use_of_technology         DOUBLE PRECISION,
    total_score_out_of_60     DOUBLE PRECISION, -- stored, = sum of the six
    overall_percentage        DOUBLE PRECISION, -- stored, = total / 60
    source_system             TEXT NOT NULL DEFAULT 'fde_production',
    migrated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, observation_date, grade, subject)
);

CREATE INDEX IF NOT EXISTS idx_nm_fico_user ON nietemigrated_fico_kpis(user_id);
CREATE INDEX IF NOT EXISTS idx_nm_fico_emis ON nietemigrated_fico_kpis(emis);
CREATE INDEX IF NOT EXISTS idx_nm_fico_date ON nietemigrated_fico_kpis(observation_date);

COMMENT ON TABLE nietemigrated_fico_kpis IS
  'FICO KPI scores, one row per (teacher x observation_date x grade x subject). '
  'Carries NO HR/PII columns by construction, so select(*) is safe from any tier. '
  'Joins teachers by user_id, NOT profile id -- read the '
  'nietemigrated_fico_with_teacher view, which owns the tie-break rule.';

-- ---------------------------------------------------------------------------
-- 6. fico_with_teacher -- scores with teacher / school / sector resolved.
--
--    WHY A VIEW: fico_kpis links by user_id, but teacher_profiles is keyed by
--    profile id, and one user_id can match two profile rows. Rather than pick a
--    winner at every call site, the tie-break lives here exactly once:
--      1. prefer the profile whose school EMIS matches the observation's emis
--         (i.e. the school the observation actually happened at)
--      2. otherwise the most recently modified profile
--
--    EXPOSURE, measured live 2026-08-04 -- small enough that a tie-break beats a
--    heavier identity model:
--      4,259 teachers, 51 with >1 active profile.
--      FICO covers 2,257 teachers, of which only 9 are multi-profile.
--      A further 9 FICO user_ids have NO active profile at all (transferred out or
--      deactivated) -- the LEFT JOINs keep their scores with a NULL teacher_name
--      instead of dropping them silently.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW nietemigrated_fico_with_teacher AS
SELECT DISTINCT ON (f.user_id, f.observation_date, f.grade, f.subject)
       f.user_id,
       f.observation_date,
       f.grade,
       f.subject,
       f.emis,
       f.planning_and_preparation,
       f.subject_knowledge,
       f.classroom_management,
       f.communication_skills,
       f.professional_development,
       f.use_of_technology,
       f.total_score_out_of_60,
       f.overall_percentage,
       tp.id         AS teacher_profile_id,
       tp.teacher_name,
       tp.levels,
       s.name        AS school_name,
       s.region_name AS sector
FROM nietemigrated_fico_kpis f
LEFT JOIN nietemigrated_teacher_profiles tp ON tp.user_id = f.user_id
LEFT JOIN nietemigrated_schools          s  ON s.id = tp.school_id
ORDER BY f.user_id, f.observation_date, f.grade, f.subject,
         (s.emis IS NOT NULL AND s.emis = f.emis) DESC,  -- 1. the observed school
         tp.modified DESC NULLS LAST;                    -- 2. most recent assignment

COMMENT ON VIEW nietemigrated_fico_with_teacher IS
  'FICO scores + resolved teacher/school/sector. Owns the user_id -> profile '
  'tie-break in ONE place: prefer the profile whose school EMIS matches the '
  'observation, else the most recently modified. LEFT JOINed, so the ~9 FICO users '
  'with no active profile keep their scores with a NULL teacher_name. Read this '
  'view; never re-derive the join at a call site.';

-- ---------------------------------------------------------------------------
-- 7. Row-level security -- service-role only until a reader exists.
--    No anon/authenticated policy is created, so RLS denies by default. Matches
--    V1.0.5's posture for the fact tables.
-- ---------------------------------------------------------------------------
ALTER TABLE nietemigrated_school_regions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE nietemigrated_schools          ENABLE ROW LEVEL SECURITY;
ALTER TABLE nietemigrated_coach_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE nietemigrated_teacher_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE nietemigrated_fico_kpis        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 8. Resolve V1.0.5's opaque FK columns, so PostgREST can embed coach / teacher /
--    school. Each statement is guarded twice: the fact table must exist and the
--    constraint must not.
--
--    NOT VALID is deliberate -- it skips the full-table check at creation, so a
--    legacy fact row pointing at a dimension row that no longer exists cannot block
--    this migration. New writes ARE checked (verified against PG16 2026-08-04: an
--    insert with a bogus coach_id is rejected). Validate later, once the dimensions
--    are loaded:
--        ALTER TABLE nietemigrated_observations VALIDATE CONSTRAINT fk_nm_obs_coach;
--    A validation failure then reports exactly how many orphan facts exist --
--    information, not an outage.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'nietemigrated_observations')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nm_obs_coach') THEN
    ALTER TABLE nietemigrated_observations
      ADD CONSTRAINT fk_nm_obs_coach
      FOREIGN KEY (coach_id) REFERENCES nietemigrated_coach_profiles(id) NOT VALID;
    RAISE NOTICE 'added fk_nm_obs_coach';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'nietemigrated_teacher_visits')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nm_tv_teacher') THEN
    ALTER TABLE nietemigrated_teacher_visits
      ADD CONSTRAINT fk_nm_tv_teacher
      FOREIGN KEY (teacher_id) REFERENCES nietemigrated_teacher_profiles(id) NOT VALID;
    RAISE NOTICE 'added fk_nm_tv_teacher';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'nietemigrated_school_visits')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nm_sv_school') THEN
    ALTER TABLE nietemigrated_school_visits
      ADD CONSTRAINT fk_nm_sv_school
      FOREIGN KEY (school_id) REFERENCES nietemigrated_schools(id) NOT VALID;
    RAISE NOTICE 'added fk_nm_sv_school';
  END IF;
END $$;

COMMIT;

-- ===========================================================================
-- DOWN -- reverse order, children before parents. Safe: nothing reads these yet.
-- Verified against PG16 2026-08-04: drops the 5 tables + view and leaves the
-- V1.0.5 fact tables untouched.
-- ===========================================================================
-- BEGIN;
-- ALTER TABLE nietemigrated_observations   DROP CONSTRAINT IF EXISTS fk_nm_obs_coach;
-- ALTER TABLE nietemigrated_teacher_visits DROP CONSTRAINT IF EXISTS fk_nm_tv_teacher;
-- ALTER TABLE nietemigrated_school_visits  DROP CONSTRAINT IF EXISTS fk_nm_sv_school;
-- DROP VIEW  IF EXISTS nietemigrated_fico_with_teacher;
-- DROP TABLE IF EXISTS nietemigrated_fico_kpis;
-- DROP TABLE IF EXISTS nietemigrated_teacher_profiles;
-- DROP TABLE IF EXISTS nietemigrated_coach_profiles;
-- DROP TABLE IF EXISTS nietemigrated_schools;
-- DROP TABLE IF EXISTS nietemigrated_school_regions;
-- COMMIT;
