-- Migration B — the layer-2 backstops, applied ONLY after the dedupe proved the
-- data clean (both violation pre-checks returned 0 on 2026-08-31).
-- Plain CREATE (not CONCURRENTLY): the tables hold ~2k rows; the lock is
-- momentary, and the management API runs one transaction per call.

-- One active child per roll per class. Roll is a locator; two children on one
-- locator is exactly how the launch-day duplication stayed invisible on paper.
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_class_roll
  ON class_enrollments (class_id, roll_number)
  WHERE is_active AND roll_number IS NOT NULL;

-- One attendance mark per child per session. 103 doubled marks existed within
-- ONE day of the duplication bug; this makes the class impossible to recreate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_one_mark
  ON attendance_records (session_id, student_id);

NOTIFY pgrst, 'reload schema';

-- DOWN: DROP INDEX IF EXISTS idx_attendance_one_mark; DROP INDEX IF EXISTS idx_enrollments_class_roll;
