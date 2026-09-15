-- Rollback for row_history_actor.
--
-- Drops the classes trigger and the timeline function, narrows the four widened
-- allowlists back to their row_history_roster shape, and restores the
-- row_history_roster log_row_changes() (no header, no role gate). Rows already
-- written with a real actor stay: they are history.

DROP FUNCTION IF EXISTS public.roster_class_timeline(uuid);
DROP TRIGGER IF EXISTS classes_history_trigger ON public.classes;

DROP TRIGGER IF EXISTS class_teachers_history_trigger ON public.class_teachers;
CREATE TRIGGER class_teachers_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.class_teachers
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'is_active', 'is_class_teacher');

DROP TRIGGER IF EXISTS class_enrollments_history_trigger ON public.class_enrollments;
CREATE TRIGGER class_enrollments_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.class_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'is_active', 'class_id', 'student_id');

DROP TRIGGER IF EXISTS students_history_trigger ON public.students;
CREATE TRIGGER students_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'student_name', 'father_name', 'roll_number', 'is_active', 'status', 'school_id');

DROP TRIGGER IF EXISTS student_lists_history_trigger ON public.student_lists;
CREATE TRIGGER student_lists_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.student_lists
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'is_active');

CREATE OR REPLACE FUNCTION public.log_row_changes() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  key_col text := TG_ARGV[0];
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
    IF cardinality(changed) = 0 THEN RETURN NULL; END IF;
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

NOTIFY pgrst, 'reload schema';
