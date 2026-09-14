-- Soft-delete for a phone-change merge: `users.merged_into`.
--
-- WHY
--   A coach editing a teacher's phone number is really MERGING two accounts:
--   the record holding her history, and whatever the new SIM already created.
--   `getOrCreateUser` mints an account for any unknown number, so the new one
--   usually exists with a few days of real work on it.
--
--   The operator's instruction (2026-09-14): the old record is SOFT deleted,
--   "in case of any accidental deletes". This column is that. The row stays,
--   its history stays queryable, and it simply stops being a live account.
--
-- WHY A COLUMN AND NOT A TABLE
--   Anti-sprawl (root CLAUDE.md rule 16): the DB is past 180 tables. This needs
--   two facts — that a row was superseded, and by which row — and both fit on
--   `users` itself. `merged_into` doubles as the tombstone (NOT NULL = merged)
--   and the forwarding pointer, so no second table and no status enum.
--
-- WHY NOT A HARD DELETE
--   A hard delete cannot be walked back, and the classifier that decides a
--   merge is safe reads counts from four tables — if any of that is ever wrong,
--   the only recovery is the original row. Cheap insurance against a bug we
--   have not found yet.
--
-- THE ESCALATION QUEUE IS NOT A NEW TABLE EITHER
--   Case 3 (the new number belongs to someone with real history) refuses the
--   merge and records the attempt. `leader_roster_audit` already carries
--   actor_user_id, teacher_phone_e164, teacher_name and a jsonb `detail`, and
--   already holds 1,000 coach actions under 'add'/'remove'/'move'. The
--   escalation is one more action value on it — queryable with a WHERE clause,
--   no migration needed for the queue itself.
--
-- IDEMPOTENT: guarded, so a re-run is a no-op.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES users(id);

COMMENT ON COLUMN users.merged_into IS
  'Set when this account was superseded by another (a phone-change merge). '
  'NOT NULL means the row is a soft-deleted tombstone: keep its history, stop '
  'treating it as a live account, and follow the pointer to the survivor. '
  'Written only by the coach Edit flow.';

-- Partial: the overwhelming majority of rows are live and never queried by this.
CREATE INDEX IF NOT EXISTS idx_users_merged_into
  ON users (merged_into) WHERE merged_into IS NOT NULL;

-- A merged row must not point at itself, or "follow the pointer" never
-- terminates. Cheap to assert, impossible to debug once it happens.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_merged_into_not_self'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_merged_into_not_self
      CHECK (merged_into IS NULL OR merged_into <> id);
  END IF;
END $$;

COMMIT;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   DROP INDEX IF EXISTS idx_users_merged_into;
--   ALTER TABLE users DROP CONSTRAINT IF EXISTS users_merged_into_not_self;
--   ALTER TABLE users DROP COLUMN IF EXISTS merged_into;
--
-- Lossless in the sense that nothing else depends on it — but dropping it
-- discards the record of WHICH account each tombstone was merged into, which is
-- the only way back from a bad merge. Capture it first.
