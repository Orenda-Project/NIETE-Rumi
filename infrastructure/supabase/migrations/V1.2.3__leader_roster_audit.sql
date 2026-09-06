-- V1.2.3 — the roster audit trail, on its own.
--
-- This exists because V1.2.2 can no longer be applied as written. That
-- migration was built for the stored-roster model: it added `deleted_at` /
-- `deleted_by` to `leader_teachers` and swapped that table's UNIQUE constraint
-- for a partial one, so a soft-deleted assignment would not block re-adding the
-- same teacher.
--
-- The model changed underneath it. A coach's people are now DERIVED —
-- `leader_schools` x `users.school_id` — so a teacher leaves a patch by her
-- school changing, and there is no assignment row to tombstone. Nothing in the
-- codebase reads `leader_teachers.deleted_at` any more (verified by grep across
-- bot/shared, dashboard/services and dashboard/routes before writing this), and
-- `leader_teachers` itself is on the way out.
--
-- So applying V1.2.2 to production would add two dead columns and churn the
-- unique constraint on a table we are removing. The ONE piece of it that
-- survived the model change is the audit table, and that is all this migration
-- carries.
--
-- Staging is at 1.2.2 and production goes to 1.2.3 without it. That gap is
-- deliberate; the eventual `leader_teachers` drop is written to be idempotent
-- across both shapes.

BEGIN;

-- Append-only history of coach-driven roster changes. Never updated, never
-- deleted. ONE ROW PER AFFECTED COACH: a change that reaches four coaches
-- writes four rows, so each of them can be told why a teacher left their list.
--
-- Deliberately not `dashboard_audit_log`: that table's user_id is FK'd to
-- `dashboard_users`, and the actor here is a coach in `users`. Reusing it would
-- mean a NULL actor on every row, which is the opposite of an audit trail.
CREATE TABLE IF NOT EXISTS leader_roster_audit (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  action                  text NOT NULL CHECK (action IN ('add', 'remove', 'move')),

  -- Who confirmed the change. Always a real coach.
  actor_user_id           uuid NOT NULL REFERENCES users(id),

  -- Whose patch this row describes. Equals actor_user_id for her own add;
  -- differs for every other coach the change reached.
  affected_leader_user_id uuid REFERENCES users(id),

  -- The teacher, denormalised ON PURPOSE: she may have no `users` row at all,
  -- and an audit row has to stay readable after the thing it describes is gone.
  teacher_ext_id          text,
  teacher_phone_e164      text,
  teacher_name            text,

  -- NULL from_ = an add. NULL to_ = a removal. Both set = a move.
  from_school_ext_id      text,
  to_school_ext_id        text,

  -- Free-form context: the reason given, how many visits were cancelled,
  -- whether the row came from a backfill rather than a coach.
  detail                  jsonb,

  created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE leader_roster_audit IS
  'Append-only history of coach-driven roster changes. One row per affected '
  'coach. Also the record that makes a backfill reversible.';

-- "What happened to this teacher?" — the question actually asked.
CREATE INDEX IF NOT EXISTS idx_roster_audit_teacher
  ON leader_roster_audit (teacher_phone_e164, created_at DESC);

-- "What did this coach do?" and "what was done TO this coach's patch?"
CREATE INDEX IF NOT EXISTS idx_roster_audit_actor
  ON leader_roster_audit (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_roster_audit_affected
  ON leader_roster_audit (affected_leader_user_id, created_at DESC);

ALTER TABLE leader_roster_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_leader_roster_audit ON leader_roster_audit;
CREATE POLICY service_role_leader_roster_audit
  ON leader_roster_audit FOR ALL USING (auth.role() = 'service_role');

GRANT ALL ON leader_roster_audit TO service_role;

COMMIT;

-- ── post-flight (expect these exactly) ─────────────────────────────────
--
--   SELECT to_regclass('leader_roster_audit') IS NOT NULL;        -- t
--   SELECT count(*) FROM leader_roster_audit;                     -- 0
--   SELECT count(*) FROM leader_teachers;                         -- unchanged
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='leader_teachers'::regclass AND contype='u';  -- the ORIGINAL
--                                                                 -- plain UNIQUE,
--                                                                 -- untouched
