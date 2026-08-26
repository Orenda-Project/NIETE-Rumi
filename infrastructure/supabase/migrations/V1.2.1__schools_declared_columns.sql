-- V1.2.1 — declare the five schools columns production already has.
--
-- 00_complete-schema.sql declares schools as (id, name, region,
-- principal_user_id, created_at, updated_at). Production carries five more --
-- emis, source_school_id, source_system, is_active, is_probable_test -- added
-- straight to the database and never recorded here or in the install file.
--
-- The cost of that gap, measured 2026-08-26: staging's schools has exactly the
-- declared six, so the portal's leader school-add path fails there on its FIRST
-- query. MASTER_SCHOOL_SQL reads 'niete:' || emis FROM schools and gets 42703,
-- column "emis" does not exist. That feature is live on production and has never
-- had a pre-prod test route. A DR rebuild from the install file would have
-- reproduced the same break on production.
--
-- THIS MIGRATION IS ADDITIVE AND CHANGES NO BEHAVIOUR.
--
--   * On production every column already exists, so all five ALTERs are no-ops
--     and this migration only records that reality. Verified against the live
--     database first: 11 columns, emis populated on 460 of 466 rows.
--   * On staging and any fresh clone it adds the columns, which is the point.
--   * ADD COLUMN with a constant DEFAULT is metadata-only from Postgres 11
--     onward, so the two NOT NULL boolean columns need no table rewrite and take
--     no long lock regardless of row count.
--   * Backfilling emis is NOT part of this migration. The column is nullable and
--     nothing reads it on staging yet; seeding staging's school list is a data
--     step, deliberately separate from the schema step.
--
-- All five are declared rather than only the two the code reads today (emis,
-- is_active). Declaring a subset would leave the same drift for the next person.
--
-- NO BEGIN/COMMIT IN THIS FILE, ON PURPOSE. infrastructure/scripts/migrate.js
-- posts the whole file to a plpgsql wrapper that EXECUTEs it, and Postgres
-- forbids transaction control inside plpgsql. Nothing is lost: that wrapper call
-- is itself one transaction, so the statements below still apply all-or-nothing.

ALTER TABLE schools ADD COLUMN IF NOT EXISTS emis             TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS source_school_id BIGINT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS source_system    TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_active        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_probable_test BOOLEAN NOT NULL DEFAULT false;

-- The roster keys a school as 'niete:' || emis, so every lookup goes through it.
CREATE INDEX IF NOT EXISTS idx_schools_emis ON schools (emis);

COMMENT ON COLUMN schools.emis IS
  'Official EMIS number. The coach roster keys a school as ''niete:'' || emis, '
  'so the portal school lookup cannot resolve anything without this column.';

COMMENT ON COLUMN schools.is_active IS
  'Soft delete. School search reads WHERE is_active IS NOT FALSE.';

-- PostgREST caches the table shape, so without this the API cannot see the new
-- columns even after the DDL commits.
NOTIFY pgrst, 'reload schema';

-- ROLLBACK: drop the five columns above and the emis index, then reload the
-- PostgREST cache. Safe on staging, where nothing has read them yet. NOT safe on
-- production, where all five hold live data -- there the rollback is to do
-- nothing, since the migration is a no-op on production by construction.
--
-- Written as prose rather than as statements because the data-standards
-- validator scans this file for destructive patterns and does not treat `--` as
-- a comment, so a spelled-out rollback reads as live DROP statements and fails
-- CI on an additive migration.
