-- row_history_audit — one generic row-history trigger for the tables whose state
-- people later argue about.
--
-- Why one table and one function, not a `*_history` twin per table: NIETE is at
-- 132 tables. Five bespoke history tables would be five more schemas to migrate,
-- index and reason about, and the columns worth auditing are a small allowlist in
-- every case. `record_history` is that allowlist, generalised. This is the same
-- shape as the `leader_roster_audit` table the roster code already writes
-- (action / actor / affected id / detail jsonb) — generalised, not replaced.
--
-- Why an ALLOWLIST and not to_jsonb(row): coaching_sessions is 902 MB across 63
-- columns, and users is rewritten constantly by counter and timestamp churn that
-- carries no information. Recording whole rows would make the history table
-- larger than the data and bury the four status transitions that matter. Every
-- trigger below names its columns; anything not named is invisible to this.
--
-- Why AFTER and not BEFORE: this must never alter the row it observes, and it
-- must not fire when the write is rolled back. users already carries a BEFORE
-- UPDATE (update_users_updated_at) — that fires first, and AFTER sees the final
-- row, so the two do not interact.
--
-- The actor is best-effort and says so. request.jwt.claims is set by PostgREST,
-- so portal and dashboard writes carry a real user id; the bot and the SQS
-- workers connect with the service-role key and land as session_user unless the
-- caller sets app.actor. actor_source records WHICH of those happened rather
-- than implying a person did it.

CREATE TABLE IF NOT EXISTS public.record_history (
  id           bigserial   PRIMARY KEY,
  table_name   text        NOT NULL,
  row_id       uuid        NOT NULL,
  op           text        NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  changed_cols text[]      NOT NULL,
  old_vals     jsonb,
  new_vals     jsonb,
  actor        text,
  actor_source text        NOT NULL CHECK (actor_source IN ('postgrest','service_role','sql')),
  txid         bigint      NOT NULL DEFAULT txid_current(),
  changed_at   timestamptz NOT NULL DEFAULT now()
);

-- "what happened to this row" — the query this whole migration exists to answer.
CREATE INDEX IF NOT EXISTS idx_record_history_row
  ON public.record_history (table_name, row_id, changed_at DESC);
-- "who changed <column> lately" — the incident query, e.g. preferred_language.
CREATE INDEX IF NOT EXISTS idx_record_history_cols
  ON public.record_history USING gin (changed_cols);
CREATE INDEX IF NOT EXISTS idx_record_history_time
  ON public.record_history (changed_at DESC);

CREATE OR REPLACE FUNCTION public.log_row_changes() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  watched text[] := TG_ARGV;          -- the allowlist, passed per-trigger
  changed text[] := '{}';
  o jsonb := '{}';
  n jsonb := '{}';
  col text;
  claims text := current_setting('request.jwt.claims', true);
  app_actor text := current_setting('app.actor', true);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOREACH col IN ARRAY watched LOOP
      IF to_jsonb(OLD) -> col IS DISTINCT FROM to_jsonb(NEW) -> col THEN
        changed := changed || col;
        o := o || jsonb_build_object(col, to_jsonb(OLD) -> col);
        n := n || jsonb_build_object(col, to_jsonb(NEW) -> col);
      END IF;
    END LOOP;
    -- The whole cost story: a counter/timestamp-only write records NOTHING.
    IF cardinality(changed) = 0 THEN
      RETURN NULL;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT coalesce(array_agg(k), '{}'), coalesce(jsonb_object_agg(k, to_jsonb(NEW) -> k), '{}')
      INTO changed, n
      FROM unnest(watched) k WHERE to_jsonb(NEW) ? k;
  ELSE
    SELECT coalesce(array_agg(k), '{}'), coalesce(jsonb_object_agg(k, to_jsonb(OLD) -> k), '{}')
      INTO changed, o
      FROM unnest(watched) k WHERE to_jsonb(OLD) ? k;
  END IF;

  INSERT INTO public.record_history
    (table_name, row_id, op, changed_cols, old_vals, new_vals, actor, actor_source)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    changed,
    nullif(o, '{}'),
    nullif(n, '{}'),
    COALESCE(
      CASE WHEN claims IS NOT NULL AND claims <> '' THEN claims::jsonb ->> 'sub' END,
      app_actor,
      session_user
    ),
    CASE
      WHEN claims IS NOT NULL AND claims <> ''         THEN 'postgrest'
      WHEN app_actor IS NOT NULL AND app_actor <> ''   THEN 'service_role'
      ELSE 'sql'
    END
  );

  RETURN NULL;   -- AFTER trigger: return value is ignored
END;
$function$;

-- ── the five tables ───────────────────────────────────────────────────────────
-- Each allowlist is the set of columns whose PAST VALUE someone has had to ask
-- about. Timestamps, counters and free text are deliberately absent.

DROP TRIGGER IF EXISTS users_history_trigger ON public.users;
CREATE TRIGGER users_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes(
    'phone_number','first_name','last_name','name','preferred_language',
    'language_locked','registration_state','registration_completed','role',
    'region','country','organization','school_id','school_name','teacher_uuid',
    'grade','subject','grades_taught','subjects_taught','levels','training_bands',
    'is_test_user','portal_activated'
  );

-- Four independent state machines on a 902 MB / 63-column table. Status only.
DROP TRIGGER IF EXISTS coaching_sessions_history_trigger ON public.coaching_sessions;
CREATE TRIGGER coaching_sessions_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.coaching_sessions
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes(
    'status','conversation_state','lesson_plan_extraction_status','debrief_status'
  );

-- Has NO updated_at column at all: today there is no way to know when a request
-- changed state, only that it did. 328 of 7,370 are 'failed'.
DROP TRIGGER IF EXISTS lesson_plan_requests_history_trigger ON public.lesson_plan_requests;
CREATE TRIGGER lesson_plan_requests_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.lesson_plan_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes(
    'status','retry_count','error_message'
  );

-- 68 rows are status='passed' WITH is_passed=false. Nothing records how.
DROP TRIGGER IF EXISTS training_assessment_attempts_history_trigger ON public.training_assessment_attempts;
CREATE TRIGGER training_assessment_attempts_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.training_assessment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes(
    'status','score','total_score','is_passed','level_id'
  );

DROP TRIGGER IF EXISTS observation_schedules_history_trigger ON public.observation_schedules;
CREATE TRIGGER observation_schedules_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.observation_schedules
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('status');
