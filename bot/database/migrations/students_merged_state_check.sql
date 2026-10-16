-- requires: student_identity.sql (adds students.status and students.merged_into)
-- Migration: a merged child record always names its target, and only a merged record does.
--
-- ADDITIVE and re-runnable. One named CHECK on students:
--   students_merged_state_chk  CHECK ((status = 'merged') = (merged_into IS NOT NULL))
-- The child identity store folds a merged record into its target by exactly this pair (status = 'merged' AND
-- merged_into set, one hop). A half-state — merged without a target, or a target on an active record — would make
-- the same child two children on one tier and one child on another. The rule now lives in the table, so no code path,
-- rebase or hand fix can write a half-state.
--
-- Dry run before applying (must read 0 on every tier; it read 0 on the production read replica and 0 on sandbox):
--   SELECT count(*) FROM students WHERE (status = 'merged') <> (merged_into IS NOT NULL);
-- If it reads > 0 the apply fails on the ADD CONSTRAINT and nothing changes: fix the rows first (clear merged_into on an
-- active record, or set status = 'merged' on a record whose target is right), then apply again.
--
-- Adds no table, so no ROW LEVEL SECURITY line (students' policies are unchanged). Rollback: students_merged_state_check_rollback.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_merged_state_chk' AND conrelid = 'students'::regclass) THEN
    ALTER TABLE students ADD CONSTRAINT students_merged_state_chk CHECK ((status = 'merged') = (merged_into IS NOT NULL));
  END IF;
END
$$;
