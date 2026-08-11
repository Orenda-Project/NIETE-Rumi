-- Schools identity (EMIS) + users.role NOT NULL
--
-- Run order: THIS FILE, then scripts/migrate-schools.py, then the role step at
-- the bottom of this file (STEP 4). The NOT NULL cannot be applied before the
-- backfill or it fails on 9,081 existing NULL rows.
--
-- Live state measured 2026-08-10 (NIETE prod, project ihzcia…):
--   schools                   0 rows
--   users                     9,281 rows; school_id set on 0; role NULL on 9,081
--   users.school_name         4,603 set, 522 distinct (vs 465 real schools)
--
-- Why an emis column at all: `schools` shipped with UNIQUE (name, region) as its
-- only natural key. That is the drifting free text this migration exists to
-- replace, and it cannot dedupe the 32 schools whose region is NULL (in Postgres
-- every NULL is distinct, so UNIQUE lets those insert repeatedly). EMIS is the
-- government identifier, verified unique across all 460 source rows that have one.

BEGIN;

-- =============================================================================
-- STEP 1: schools — identity + provenance
-- =============================================================================
ALTER TABLE schools ADD COLUMN IF NOT EXISTS emis             TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS source_school_id BIGINT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS source_system    TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_active        BOOLEAN NOT NULL DEFAULT TRUE;

-- The 19 junk source schools ('Taleemabad', 'LUMS', 'Testing School', …) carry
-- 239 teachers and 21 principals between them, so they are migrated and flagged
-- rather than dropped — dropping them would orphan real users' school_id.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_probable_test BOOLEAN NOT NULL DEFAULT FALSE;

-- EMIS is the upsert key. Partial unique so the 5 EMIS-less schools coexist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_emis_unique
  ON schools (emis) WHERE emis IS NOT NULL;

-- Fallback identity for the 5 without EMIS: canonicalised name + region.
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_name_canon_region
  ON schools (UPPER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g')), COALESCE(region, ''))
  WHERE emis IS NULL;

CREATE INDEX IF NOT EXISTS idx_schools_source ON schools (source_system, source_school_id);

-- The pre-existing UNIQUE (name, region) would reject legitimately distinct
-- schools that share a display name ('Taleemabad' appears twice in source, as
-- emis 1 and emis 98000 — 79 and 29 teachers respectively). EMIS now carries
-- identity, so this constraint is retired.
ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_name_region_key;

-- =============================================================================
-- STEP 2: users.school_id — the FK read path
-- =============================================================================
-- Column + FK already exist (users.school_id uuid → schools.id). Only the index
-- is missing, and every school-scoped read will need it.
CREATE INDEX IF NOT EXISTS idx_users_school_id
  ON users (school_id) WHERE school_id IS NOT NULL;

-- =============================================================================
-- STEP 3: role — widen the vocabulary before the backfill writes to it
-- =============================================================================
-- Existing values: teacher (114), coach (79), principal (7), NULL (9,081).
-- 'unregistered' is added because all 9,081 NULL rows are
-- registration_state='unregistered' with only 94 registration_completed —
-- calling them teachers would inflate the teacher count ~80x.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('teacher', 'principal', 'coach', 'unregistered'));

COMMIT;

-- =============================================================================
-- STEP 4: role NOT NULL — RUN ONLY AFTER scripts/migrate-schools.py --commit
-- =============================================================================
-- Kept out of the transaction above deliberately: it MUST fail loudly if the
-- backfill has not run, rather than being silently included in a rollback.
--
--   BEGIN;
--   -- must return 0 before proceeding
--   SELECT count(*) FROM users WHERE role IS NULL;
--   ALTER TABLE users ALTER COLUMN role SET DEFAULT 'teacher';
--   ALTER TABLE users ALTER COLUMN role SET NOT NULL;
--   COMMIT;
--
-- DEFAULT 'teacher' is correct for NEW rows: registration creates teachers.
-- It is NOT correct for the 9,081 legacy unregistered rows, which is why the
-- backfill classifies them explicitly instead of leaning on the default.
