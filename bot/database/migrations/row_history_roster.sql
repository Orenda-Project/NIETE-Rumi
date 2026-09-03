-- row_history_roster — extend record_history to the roster and config tables.
--
-- These are the low-churn / high-blast-radius half of the audit. Nobody notices
-- a wrong roster row the day it happens; they notice a month later when a child
-- is missing from a register or a school stopped receiving anything, and by then
-- the only question that matters is "what did this row used to say".
--
-- Production churn is tiny (schools: 1 update, class_teachers: 5,
-- teacher_training_assignments: 6), so the cost here is nil. app_settings is the
-- outlier that justifies the whole batch: it holds LIVE operational config —
-- the RDF posting state and snapshots — and shows 11 updates against ZERO
-- inserts. Config is being mutated in place with no history of the previous value.
--
-- WHY THIS MIGRATION CHANGES log_row_changes()
--
-- The original function read COALESCE(NEW.id, OLD.id) and wrote it into a uuid
-- column. app_settings has NO id column at all — its primary key is `key text` —
-- so attaching the old function to it fails at runtime with
-- `record "new" has no field "id"` (verified against staging before writing this).
-- Rather than exclude the one table that most needs auditing, the function now
-- resolves its row key generically: it takes the key column name as its FIRST
-- trigger argument and reads it out of the row's jsonb, so any single-column
-- primary key works regardless of type.
--
-- record_history.row_id becomes text to carry both uuids and natural keys. Every
-- existing uuid still round-trips as its canonical text form, so the queries in
-- the original migration keep working; a uuid comparison needs row_id = $1::text.
-- Nothing has been written to record_history in production yet, so widening the
-- column now costs nothing.

ALTER TABLE public.record_history
  ALTER COLUMN row_id TYPE text USING row_id::text;

CREATE OR REPLACE FUNCTION public.log_row_changes() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  key_col text := TG_ARGV[0];                        -- the row's primary key column
  watched text[] := TG_ARGV[1:array_upper(TG_ARGV,1)];
  changed text[] := '{}';
  o jsonb := '{}';
  n jsonb := '{}';
  col text;
  jold jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  jnew jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  rid text;
  claims text := current_setting('request.jwt.claims', true);
  app_actor text := current_setting('app.actor', true);
BEGIN
  rid := COALESCE(jnew -> key_col, jold -> key_col) #>> '{}';
  IF rid IS NULL THEN
    RAISE EXCEPTION 'log_row_changes: table %.% has no key column %',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, key_col;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOREACH col IN ARRAY watched LOOP
      IF jold -> col IS DISTINCT FROM jnew -> col THEN
        changed := changed || col;
        o := o || jsonb_build_object(col, jold -> col);
        n := n || jsonb_build_object(col, jnew -> col);
      END IF;
    END LOOP;
    IF cardinality(changed) = 0 THEN
      RETURN NULL;                                   -- nothing watched moved
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT coalesce(array_agg(k), '{}'), coalesce(jsonb_object_agg(k, jnew -> k), '{}')
      INTO changed, n FROM unnest(watched) k WHERE jnew ? k;
  ELSE
    SELECT coalesce(array_agg(k), '{}'), coalesce(jsonb_object_agg(k, jold -> k), '{}')
      INTO changed, o FROM unnest(watched) k WHERE jold ? k;
  END IF;

  INSERT INTO public.record_history
    (table_name, row_id, op, changed_cols, old_vals, new_vals, actor, actor_source)
  VALUES (
    TG_TABLE_NAME, rid, TG_OP, changed, nullif(o,'{}'), nullif(n,'{}'),
    COALESCE(
      CASE WHEN claims IS NOT NULL AND claims <> '' THEN claims::jsonb ->> 'sub' END,
      app_actor, session_user),
    CASE
      WHEN claims IS NOT NULL AND claims <> ''       THEN 'postgrest'
      WHEN app_actor IS NOT NULL AND app_actor <> '' THEN 'service_role'
      ELSE 'sql' END
  );
  RETURN NULL;
END;
$function$;

-- ── re-point the original five: every trigger now passes its key column first ──

DROP TRIGGER IF EXISTS users_history_trigger ON public.users;
CREATE TRIGGER users_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'phone_number','first_name','last_name','name','preferred_language',
    'language_locked','registration_state','registration_completed','role',
    'region','country','organization','school_id','school_name','teacher_uuid',
    'grade','subject','grades_taught','subjects_taught','levels','training_bands',
    'is_test_user','portal_activated');

DROP TRIGGER IF EXISTS coaching_sessions_history_trigger ON public.coaching_sessions;
CREATE TRIGGER coaching_sessions_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.coaching_sessions
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'status','conversation_state','lesson_plan_extraction_status','debrief_status');

DROP TRIGGER IF EXISTS lesson_plan_requests_history_trigger ON public.lesson_plan_requests;
CREATE TRIGGER lesson_plan_requests_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.lesson_plan_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'status','retry_count','error_message');

DROP TRIGGER IF EXISTS training_assessment_attempts_history_trigger ON public.training_assessment_attempts;
CREATE TRIGGER training_assessment_attempts_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.training_assessment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'status','score','total_score','is_passed','level_id');

DROP TRIGGER IF EXISTS observation_schedules_history_trigger ON public.observation_schedules;
CREATE TRIGGER observation_schedules_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.observation_schedules
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id','status');

-- ── the nine roster / config tables ──────────────────────────────────────────

-- The reason this batch exists: live operational config, mutated in place.
-- Text primary key — the case the old function could not handle.
DROP TRIGGER IF EXISTS app_settings_history_trigger ON public.app_settings;
CREATE TRIGGER app_settings_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('key','value');

-- A closed enrolment is a child removed from a register. 460 students already
-- sit in 'merged' with no record of what merged into what.
DROP TRIGGER IF EXISTS class_enrollments_history_trigger ON public.class_enrollments;
CREATE TRIGGER class_enrollments_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.class_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id','is_active','class_id','student_id');

DROP TRIGGER IF EXISTS students_history_trigger ON public.students;
CREATE TRIGGER students_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'student_name','father_name','roll_number','is_active','status','school_id');

DROP TRIGGER IF EXISTS student_lists_history_trigger ON public.student_lists;
CREATE TRIGGER student_lists_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.student_lists
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id','is_active');

-- 463 of 466 active. A school flipped inactive stops receiving everything.
DROP TRIGGER IF EXISTS schools_history_trigger ON public.schools;
CREATE TRIGGER schools_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'name','emis','region','principal_user_id','is_active');

DROP TRIGGER IF EXISTS teacher_attendance_records_history_trigger ON public.teacher_attendance_records;
CREATE TRIGGER teacher_attendance_records_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.teacher_attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'status','leave_type','school_id');

DROP TRIGGER IF EXISTS class_teachers_history_trigger ON public.class_teachers;
CREATE TRIGGER class_teachers_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.class_teachers
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'is_active','is_class_teacher');

DROP TRIGGER IF EXISTS teacher_training_assignments_history_trigger ON public.teacher_training_assignments;
CREATE TRIGGER teacher_training_assignments_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.teacher_training_assignments
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'is_active','assigned_by');

DROP TRIGGER IF EXISTS exam_check_sessions_history_trigger ON public.exam_check_sessions;
CREATE TRIGGER exam_check_sessions_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_check_sessions
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id','status');
