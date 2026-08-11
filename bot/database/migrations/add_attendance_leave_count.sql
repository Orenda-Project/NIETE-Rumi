-- Attendance: session-level tally for students/teachers on leave.
--
-- Verified against the live database on 2026-08-10 before writing this:
--   * attendance_records.status ALREADY accepts 'leave' (probe insert succeeded),
--     so the CHECK constraint needs no change.
--   * attendance_sessions.leave_count does NOT exist — a leave cannot round-trip
--     to the register summary without it.
--
-- So this migration is deliberately one column, not the CHECK-widening the
-- earlier draft assumed. Marking writes present/absent/leave per record and the
-- session carries the three tallies.
--
-- Safe + idempotent. Run on staging first.

BEGIN;

ALTER TABLE attendance_sessions
  ADD COLUMN IF NOT EXISTS leave_count INTEGER DEFAULT 0;

UPDATE attendance_sessions SET leave_count = 0 WHERE leave_count IS NULL;

COMMENT ON COLUMN attendance_sessions.leave_count IS
  'Students marked on leave (excused) — distinct from absent_count. Added 2026-08.';

COMMIT;

-- ROLLBACK (manual):
--   ALTER TABLE attendance_sessions DROP COLUMN IF EXISTS leave_count;
