-- students_history_list_id — the hand-over's move of a child onto the class teacher's
-- attendance list becomes an explicit ledger row.
--
-- LIVE DEFINITION BEFORE THIS FILE, read-only pg_get_triggerdef on 2026-09-15 — identical
-- on NIETE sandbox, staging and prod:
--
--   CREATE TRIGGER students_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.students
--   FOR EACH ROW EXECUTE FUNCTION log_row_changes('id', 'student_name', 'father_name',
--   'roll_number', 'is_active', 'status', 'school_id', 'merged_into', 'admission_no')
--
-- roster_hand_over_class() repoints every enrolled child's students.list_id onto the new
-- class teacher's list (attendance reads exactly that FK). list_id was not watched, so an
-- UPDATE that changed only list_id wrote NO record_history row at all: the move could only
-- be inferred from the student_lists rows sharing its txid. Edit-class and /class inserts
-- also landed without saying which list a child was put on.
--
-- WHAT CHANGES: list_id is appended to the students allowlist. Nothing else — same trigger
-- name, same function, same timing, same other columns in the same order. Mirrored in
-- scripts/row-history-audit.js WATCHED.students.
--
-- COST: one extra ledger row per child whose list actually changes (a hand-over of a
-- 40-child class = 40 small rows, once), plus the list id on each students INSERT row.
-- A write that sets list_id to the value it already had records nothing (the trigger
-- compares old and new).
--
-- Re-runnable: DROP TRIGGER IF EXISTS + CREATE TRIGGER, trigger DDL only, no data rewrite.
-- DOWN: students_history_list_id_rollback.sql

DROP TRIGGER IF EXISTS students_history_trigger ON public.students;
CREATE TRIGGER students_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'student_name', 'father_name', 'roll_number', 'is_active', 'status', 'school_id',
    'merged_into', 'admission_no', 'list_id');
