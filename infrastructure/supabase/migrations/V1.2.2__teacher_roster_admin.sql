-- V1.2.2 — coaches add and remove individual teachers at a school, with a history
-- record and an audit trail, and removal as a SOFT delete.
--
-- Operator, 2026-08-28. Written against the live NIETE schema
-- (`ihzciabopbttygxxgrkm`, queried 2026-08-28), not from memory:
--
--   leader_teachers   8,095 rows / 401 schools / 71 coaches / 6,607 phones
--   UNIQUE (leader_user_id, source, school_ext_id, teacher_ext_id)  -- PLAIN
--   CHECK  (source = 'niete_ict')
--   idx_leader_teachers_leader_school (leader_user_id, school_ext_id)
--   idx_leader_teachers_phone_e164    (teacher_phone_e164)
--
-- THREE things this has to get right, each of which has a live counter-example:
--
--   1. The existing UNIQUE is a PLAIN index. Soft-delete a row and the same
--      teacher can never be re-added to that school by that coach — the insert
--      dies on 23505 against a row the coach cannot see. It has to become a
--      PARTIAL unique index over the live rows only. This is the single change
--      here that, if skipped, turns "remove" into "remove permanently".
--
--   2. `source` is pinned by CHECK (source = 'niete_ict'), so provenance CANNOT
--      be recorded by writing a different source value — every such insert dies
--      on 23514. Unit tests inject a fake query builder and cannot catch it;
--      only a real write does. Hence a separate audit table rather than a
--      cleverer `source`.
--
--   3. A teacher is held by more than one coach on 1,155 (school,teacher) pairs.
--      Removing her from a school is N row-updates, and the audit therefore
--      records ONE ROW PER AFFECTED COACH — otherwise "why did she vanish from
--      my list?" has no answer for the coaches who did not do it.

BEGIN;

-- ── 1. soft delete ─────────────────────────────────────────────────────

ALTER TABLE leader_teachers
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);

COMMENT ON COLUMN leader_teachers.deleted_at IS
  'Soft delete. NULL = live. Set when a coach takes the teacher off this school; '
  'her users row, her coaching_sessions and her observation_schedules are untouched.';
COMMENT ON COLUMN leader_teachers.deleted_by IS
  'The coach who performed the removal — NOT necessarily leader_user_id, since a '
  'removal from a school reaches every coach holding that teacher there.';

-- Live rows are the overwhelming majority forever, so the read path wants a
-- partial index rather than a column added to the existing composite.
CREATE INDEX IF NOT EXISTS idx_leader_teachers_live
  ON leader_teachers (leader_user_id, school_ext_id)
  WHERE deleted_at IS NULL;

-- ── 2. the unique key has to stop counting tombstones ──────────────────

-- Guarded: the constraint name is Postgres-generated and truncated, so assert
-- it exists before dropping rather than failing the whole migration on a
-- rename. Dropping the CONSTRAINT drops its backing index with it.
ALTER TABLE leader_teachers
  DROP CONSTRAINT IF EXISTS leader_teachers_leader_user_id_source_school_ext_id_teacher_key;

CREATE UNIQUE INDEX IF NOT EXISTS leader_teachers_live_assignment_key
  ON leader_teachers (leader_user_id, source, school_ext_id, teacher_ext_id)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX leader_teachers_live_assignment_key IS
  'Replaces the plain UNIQUE constraint. Partial, so a removed-then-re-added '
  'teacher does not collide with her own tombstone (23505).';

-- ── 3. the audit trail ─────────────────────────────────────────────────

-- Append-only. Never updated, never deleted. One row per affected coach.
--
-- Deliberately NOT `dashboard_audit_log`: that table's user_id is FK'd to
-- dashboard_users, and the actor here is a coach in `users`. Reusing it would
-- mean a NULL actor on every row, which is the opposite of an audit trail.
CREATE TABLE IF NOT EXISTS leader_roster_audit (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  action                   text NOT NULL
                             CHECK (action IN ('add', 'remove', 'move')),

  -- Who tapped confirm. Always a real coach.
  actor_user_id            uuid NOT NULL REFERENCES users(id),

  -- Whose patch this row describes a change to. Equals actor_user_id for her
  -- own add; differs for every other coach a move or a removal reached.
  affected_leader_user_id  uuid REFERENCES users(id),

  -- The teacher, denormalised ON PURPOSE — she may have no `users` row at all
  -- (3 live roster phones do not), and an audit row must stay readable after
  -- the roster row it describes is gone.
  teacher_ext_id           text,
  teacher_phone_e164       text,
  teacher_name             text,

  -- NULL from_ = an add. NULL to_ = a removal. Both set = a move.
  from_school_ext_id       text,
  to_school_ext_id         text,

  -- Free-form context: the reason she gave, the pre-write plan we showed her,
  -- whether users.school_id was updated, the ambiguity we refused on.
  detail                   jsonb,

  created_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE leader_roster_audit IS
  'Append-only history of coach-driven roster changes. One row per affected '
  'coach: a move that reaches 4 coaches writes 4 rows, so each of them can be '
  'told why a teacher left their list.';

-- "What happened to this teacher?" — the question the operator will actually ask.
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

-- ── post-flight (run by hand, expect the stated values) ────────────────
--
--   -- the partial unique replaced the plain one, and IS valid
--   SELECT indexrelid::regclass, indisvalid, indisunique, pg_get_expr(indpred, indrelid)
--   FROM pg_index WHERE indrelid = 'leader_teachers'::regclass AND indisunique;
--   -- expect leader_teachers_live_assignment_key, valid, unique,
--   --        predicate "deleted_at IS NULL"; and NO plain 4-column unique left.
--
--   -- nothing was soft-deleted by the migration itself
--   SELECT count(*) FROM leader_teachers WHERE deleted_at IS NOT NULL;   -- expect 0
--   SELECT count(*) FROM leader_teachers;                                -- expect 8095
--
-- ── KNOWN FOLLOW-UP, deliberately not in this migration ────────────────
--
-- `removeSchoolForCoach()` in observe-school-admin.service.js still issues a
-- hard DELETE on leader_teachers. Once teachers have tombstones, removing a
-- SCHOOL destroys what removing a TEACHER preserves — the two paths disagree.
-- That is a code change, not a schema one, so it ships with the service work
-- rather than here.
