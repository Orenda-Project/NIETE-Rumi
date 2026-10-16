-- Rollback: students_merged_state_check.sql. Drops the CHECK; no row changes.
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_merged_state_chk;
