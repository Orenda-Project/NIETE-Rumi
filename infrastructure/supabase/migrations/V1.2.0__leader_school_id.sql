-- V1.2.0 — Phase 1: identify a school by schools.id, not by a spreadsheet string.
--
-- Today leader_schools decides which school a row is about by reading
-- school_ext_id = 'niete:' || <EMIS typed into the coach roster sheet>. Two rows
-- got the wrong number typed in, which is why one school can appear twice for the
-- same coach, and why roster inheritance (WHERE school_ext_id = $1) can hand a
-- coach a second school's teachers. Every other table in this schema points at a
-- school with schools.id. These three did not.
--
-- THIS MIGRATION IS ADDITIVE AND CHANGES NO BEHAVIOUR. It adds a nullable
-- school_id and two indexes. Nothing reads the column yet, so there is nothing a
-- live user can notice. The backfill is a separate step, and NOT NULL plus
-- UNIQUE (leader_user_id, school_id) come later, once every row is filled.
--
-- Why it is safe to run against live tables:
--
--   * ADD COLUMN with no DEFAULT is metadata-only from Postgres 11 onward. No
--     table rewrite, no long lock, regardless of row count.
--   * The foreign key has nothing to validate: every existing row gets NULL.
--   * Plain CREATE INDEX rather than CONCURRENTLY is deliberate. These tables
--     hold hundreds to low thousands of rows, so the build takes milliseconds,
--     and CONCURRENTLY cannot run here anyway: see the note on transactions below.
--
-- NO BEGIN/COMMIT IN THIS FILE, ON PURPOSE. infrastructure/scripts/migrate.js
-- posts the whole file to a plpgsql wrapper that EXECUTEs it. Postgres forbids
-- transaction control inside plpgsql, so a migration carrying BEGIN/COMMIT fails
-- to apply through the runner. Three older migrations (V1.0.9, V1.0.10, V1.1.6)
-- have them and had to be applied by hand; the newest, V1.1.9, does not. Nothing
-- is lost: that wrapper call is itself one transaction, so the statements below
-- still apply all-or-nothing. It is also why CREATE INDEX CONCURRENTLY is not an
-- option here.
--
-- Ordering note: schools(id) already exists (V1.0.7), so the reference resolves.
--
-- Full plan: docs/leader-schools-school-id-migration.md

ALTER TABLE leader_schools
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id);

ALTER TABLE leader_teachers
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id);

ALTER TABLE observation_schedules
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id);

-- The read path switches to these in a later phase. Indexing now keeps that
-- change to a one-line diff per call site.
CREATE INDEX IF NOT EXISTS idx_leader_schools_school_id
  ON leader_schools (school_id);

CREATE INDEX IF NOT EXISTS idx_leader_teachers_school_id
  ON leader_teachers (school_id);

COMMENT ON COLUMN leader_schools.school_id IS
  'The school this row is about. Authoritative once backfilled; school_ext_id '
  'stays as a record of what the roster sheet said.';

COMMENT ON COLUMN leader_teachers.school_id IS
  'Copied from the parent leader_schools row during the backfill.';

COMMENT ON COLUMN observation_schedules.school_id IS
  'The school this observation was scheduled at, independent of the sheet EMIS.';

-- PostgREST caches the table shape, so without this the bot cannot see the new
-- column even after the DDL commits.
NOTIFY pgrst, 'reload schema';

-- ROLLBACK, safe at any point in this phase because nothing reads the column:
-- remove school_id from the three tables above, then reload the PostgREST cache.
-- Each ALTER is independent, so a partial rollback is also consistent.
--
-- The statements are described rather than written out on purpose. The
-- data-standards validator scans this file for destructive patterns and does not
-- treat `--` as a comment, so a spelled-out rollback reads as three live
-- destructive statements and fails CI on an additive migration.
