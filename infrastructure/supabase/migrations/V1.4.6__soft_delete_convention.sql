-- Soft delete as ONE convention, and a function to add it to any table.
--
-- WHY
--   Retiring a row without destroying it keeps coming up — a merged duplicate,
--   a school that closed, a roster row added by mistake. Left to each feature it
--   gets a new spelling every time, and "is this row live?" stops having a
--   single answer. This schema is already drifting:
--
--     is_active       32 tables
--     deleted_at      10 tables (all nietemigrated_*, inherited from the
--                     source system — a convention we received, not chose)
--     superseded_at    1 table
--     superseded_by    1 table
--
--   The coach Edit-teacher work was about to add a 5th spelling —
--   `users.merged_into`, a merge-specific column doubling as a tombstone. The
--   operator's call (2026-09-14): make it generic so others can use it too.
--
-- THE CONVENTION
--     deleted_at      timestamptz  WHEN. NULL = live. THE predicate.
--     deleted_reason  text         WHY, a short machine token.
--     deleted_by      text         WHO (an actor id) or WHAT (a process name).
--
--   A timestamp rather than a boolean: `is_active` answers "is it live" and
--   nothing else, while `deleted_at` answers that AND "since when", which is
--   what an investigation actually asks. `is_active` keeps its existing
--   domain meanings — a deactivated training assignment is not a deleted row.
--
--   Read them through bot/shared/utils/soft-delete.js, never by hand.
--
-- NOT INCLUDED, DELIBERATELY
--   No `superseded_by`. "Replaced by that row" is a different fact from
--   "retired", only some retirements have a successor, and overloading the
--   tombstone with a pointer is how the next feature ends up unable to use it.
--   A merge records its survivor in its own audit row.
--
-- SCOPE OF THIS MIGRATION
--   Adds the helper function, then applies it to `users` only — the table the
--   Edit-teacher merge needs. Other tables adopt it when they need it, with one
--   line: SELECT add_soft_delete('table_name');
--   Nothing is backfilled and no existing column is touched, so this cannot
--   change the behaviour of anything reading is_active today.
--
-- IDEMPOTENT: the function is CREATE OR REPLACE and its body guards every
-- column, so re-running is a no-op.

BEGIN;

CREATE OR REPLACE FUNCTION add_soft_delete(p_table text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = p_table
  ) THEN
    RAISE EXCEPTION 'add_soft_delete: no such table %', p_table;
  END IF;

  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', p_table);
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_reason text', p_table);
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by text', p_table);

  -- Partial: almost every row is live, so the index only carries tombstones.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (deleted_at) WHERE deleted_at IS NOT NULL',
    'idx_' || p_table || '_deleted_at', p_table);

  EXECUTE format(
    'COMMENT ON COLUMN %I.deleted_at IS %L', p_table,
    'Soft delete: when this row was retired. NULL = live. Read it through '
    'bot/shared/utils/soft-delete.js (isDeleted/liveOnly), never by hand.');
  EXECUTE format(
    'COMMENT ON COLUMN %I.deleted_reason IS %L', p_table,
    'Soft delete: why, as a short machine token (e.g. phone_change_merge).');
  EXECUTE format(
    'COMMENT ON COLUMN %I.deleted_by IS %L', p_table,
    'Soft delete: who (actor id) or what (process name) retired it.');
END;
$fn$;

COMMENT ON FUNCTION add_soft_delete(text) IS
  'Add the three-column soft-delete convention to a table. One line per table: '
  'SELECT add_soft_delete(''schools''); Idempotent.';

-- The table the coach Edit-teacher merge needs. Others adopt it when they do.
SELECT add_soft_delete('users');

-- ------------------------------------------------------------ prove it took
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='users'
     AND column_name IN ('deleted_at','deleted_reason','deleted_by');
  IF n <> 3 THEN
    RAISE EXCEPTION 'users has % of the 3 soft-delete columns', n;
  END IF;
END $$;

COMMIT;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   DROP INDEX IF EXISTS idx_users_deleted_at;
--   ALTER TABLE users DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS
--     deleted_reason, DROP COLUMN IF EXISTS deleted_by;
--   DROP FUNCTION IF EXISTS add_soft_delete(text);
--
-- Dropping the columns discards every tombstone's reason and actor — which is
-- the only record of why a row was retired. Capture them first if any exist.
