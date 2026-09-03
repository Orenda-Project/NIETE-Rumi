-- Rollback for row_history_roster.
--
-- Drops the nine roster/config triggers and restores nothing else: the widened
-- row_id (uuid -> text) and the key-column argument stay, because reverting them
-- would break the original five triggers this migration re-pointed. To go all
-- the way back, run row_history_audit_rollback.sql and re-apply row_history_audit.sql.

DROP TRIGGER IF EXISTS app_settings_history_trigger ON public.app_settings;
DROP TRIGGER IF EXISTS class_enrollments_history_trigger ON public.class_enrollments;
DROP TRIGGER IF EXISTS students_history_trigger ON public.students;
DROP TRIGGER IF EXISTS student_lists_history_trigger ON public.student_lists;
DROP TRIGGER IF EXISTS schools_history_trigger ON public.schools;
DROP TRIGGER IF EXISTS teacher_attendance_records_history_trigger ON public.teacher_attendance_records;
DROP TRIGGER IF EXISTS class_teachers_history_trigger ON public.class_teachers;
DROP TRIGGER IF EXISTS teacher_training_assignments_history_trigger ON public.teacher_training_assignments;
DROP TRIGGER IF EXISTS exam_check_sessions_history_trigger ON public.exam_check_sessions;
