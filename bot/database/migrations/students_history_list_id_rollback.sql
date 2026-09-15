-- DOWN for students_history_list_id.sql — restores the students allowlist exactly as
-- row_history_actor.sql left it (the live definition on sandbox, staging and prod on
-- 2026-09-15). Re-runnable. Ledger rows already written with list_id are kept.

DROP TRIGGER IF EXISTS students_history_trigger ON public.students;
CREATE TRIGGER students_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'student_name', 'father_name', 'roll_number', 'is_active', 'status', 'school_id',
    'merged_into', 'admission_no');
