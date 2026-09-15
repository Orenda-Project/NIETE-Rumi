-- row_history_actor — the ledger names a REAL actor, and the class itself is in it.
--
-- MEASURED ON PRODUCTION, 2026-09-15, read-only, before this was written:
--
--   record_history rows           189,013
--   actor IS NULL                        0
--   actor is a uuid                      0
--   actor = 'authenticator'        188,963   (actor_source = 'postgrest')
--   actor = 'postgres'                  50   (actor_source = 'sql')
--
-- The brief said "actor is NULL on every bot write". It is not NULL — it is worse.
-- The bot's service-role JWT has role=service_role and no `sub`, so the trigger's
-- COALESCE(claims->>'sub', app.actor, session_user) fell through to session_user,
-- while actor_source still said 'postgrest' as if a person had been identified.
-- Every coach save, every hand-over, every struck-off child: 'authenticator'.
--
-- WHAT CHANGES (all additive; DOWN in row_history_actor_rollback.sql):
--
-- 1. log_row_changes() gains a fourth source of truth, the `x-rumi-actor` request
--    header. PostgREST forwards request headers into the transaction as
--    `request.headers` (verified on the sandbox project with a probe function), so
--    the bot can name the coach on a direct .insert()/.update() AND on an .rpc(),
--    through the transaction pooler, with no signature change anywhere. The bot
--    sets it from an AsyncLocalStorage context at the Flow endpoint
--    (bot/shared/utils/actor-context.js).
--
--    Precedence:  jwt sub  >  app.actor (set in-transaction)  >  header  >  session_user.
--    The header is honoured ONLY when the JWT role is service_role (a key that can
--    already write anything — the header is attribution, not authority) and ONLY
--    when the value is uuid-shaped. actor_source stays inside its existing CHECK:
--    a header-attributed row is 'service_role', the same label an app.actor row
--    gets — both mean "the service-role caller told us who". No new enum value.
--
-- 2. `classes` joins the audited set. grade_code / section / shift_code ARE the
--    class identity (unique on school+grade+section+shift+session) and the
--    saved-roster edit screen (bd-tf3jg) mutates exactly those; a class closed by
--    a merge is is_active -> false with the enrolments moving in the SAME txid.
--
-- 3. Four roster allowlists widen so one class's history reads from the ledger
--    alone. An INSERT records only watched columns, so a hand-over used to land as
--    {is_active, is_class_teacher} with no class and no teacher in it.
--      class_teachers    + class_id, teacher_user_id
--      class_enrollments + roll_number, outcome
--      students          + merged_into, admission_no
--      student_lists     + class_id, user_id
--    Cost: identity columns never change on UPDATE, so they add bytes to INSERT
--    rows only; roll/outcome/merged_into change once per coach correction.
--
-- 4. roster_class_timeline(uuid) — the read path. One class's history, oldest
--    first: who, when, which row, what changed, from what — with the actor
--    resolved to a name/role when it is a users.id. Usable from SQL today and as
--    an RPC by a portal later. SECURITY DEFINER, service_role only.
--
-- NO NEW TABLE (root Rule 15). record_history already has the shape (table, row,
-- op, old, new, actor, txid, when) and 189k rows of history in it; a
-- `roster_changes` twin would split the same facts across two places. The only
-- thing it lacked was a trustworthy actor and one table — both fixed in place.

-- ── 1. the trigger function ───────────────────────────────────────────────────

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
  claims_txt text := nullif(current_setting('request.jwt.claims', true), '');
  claims jsonb;
  jwt_sub text;
  jwt_role text;
  app_actor text := nullif(current_setting('app.actor', true), '');
  hdr_txt text := nullif(current_setting('request.headers', true), '');
  hdr_actor text;
  v_actor text;
  v_source text;
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

  -- ── who ──
  -- Malformed claims/headers degrade to "unknown", never to a failed write: the
  -- ledger must never be the reason a roster did not save.
  BEGIN
    claims := claims_txt::jsonb;
  EXCEPTION WHEN others THEN
    claims := CASE WHEN claims_txt IS NULL THEN NULL ELSE '{}'::jsonb END;
  END;
  jwt_sub  := nullif(claims ->> 'sub', '');
  jwt_role := claims ->> 'role';
  BEGIN
    hdr_actor := lower(nullif(hdr_txt::jsonb ->> 'x-rumi-actor', ''));
  EXCEPTION WHEN others THEN
    hdr_actor := NULL;
  END;
  IF hdr_actor IS NOT NULL AND hdr_actor !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    hdr_actor := NULL;                               -- a users.id or nothing
  END IF;

  IF jwt_sub IS NOT NULL THEN
    v_actor := jwt_sub;            v_source := 'postgrest';
  ELSIF app_actor IS NOT NULL THEN
    v_actor := app_actor;          v_source := 'service_role';
  ELSIF hdr_actor IS NOT NULL AND jwt_role = 'service_role' THEN
    v_actor := hdr_actor;          v_source := 'service_role';
  ELSIF claims IS NOT NULL THEN
    v_actor := session_user::text; v_source := 'postgrest';   -- unchanged legacy shape
  ELSE
    v_actor := session_user::text; v_source := 'sql';
  END IF;

  INSERT INTO public.record_history
    (table_name, row_id, op, changed_cols, old_vals, new_vals, actor, actor_source)
  VALUES (TG_TABLE_NAME, rid, TG_OP, changed, nullif(o,'{}'), nullif(n,'{}'), v_actor, v_source);
  RETURN NULL;
END;
$function$;

-- ── 2. classes ────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS classes_history_trigger ON public.classes;
CREATE TRIGGER classes_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'school_id', 'grade_code', 'section', 'shift_code', 'session_code', 'is_active',
    'created_by_user_id');

-- ── 3. the widened roster allowlists ──────────────────────────────────────────

DROP TRIGGER IF EXISTS class_teachers_history_trigger ON public.class_teachers;
CREATE TRIGGER class_teachers_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.class_teachers
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'is_active', 'is_class_teacher', 'class_id', 'teacher_user_id');

DROP TRIGGER IF EXISTS class_enrollments_history_trigger ON public.class_enrollments;
CREATE TRIGGER class_enrollments_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.class_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'is_active', 'class_id', 'student_id', 'roll_number', 'outcome');

DROP TRIGGER IF EXISTS students_history_trigger ON public.students;
CREATE TRIGGER students_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'student_name', 'father_name', 'roll_number', 'is_active', 'status', 'school_id',
    'merged_into', 'admission_no');

DROP TRIGGER IF EXISTS student_lists_history_trigger ON public.student_lists;
CREATE TRIGGER student_lists_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.student_lists
  FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id',
    'is_active', 'class_id', 'user_id');

-- ── 4. the read path: one class, oldest first ─────────────────────────────────
--
-- Rows are found three ways, because the ledger predates the widened allowlists:
--   (a) the class row itself (row_id = the class id);
--   (b) rows whose payload names the class (new_vals/old_vals ->> 'class_id') —
--       every row written after this migration, and every enrolment MOVE before it;
--   (c) rows keyed on a live child row of the class (class_teachers, class_enrollments,
--       student_lists by class_id; students through class_enrollments, active or not) —
--       the pre-migration rows, which carried no class id of their own.
-- A merge shows as: classes.is_active true->false and N class_enrollments.class_id
-- moves sharing ONE txid — that txid is the merge, and `what` names the target.

CREATE OR REPLACE FUNCTION public.roster_class_timeline(p_class_id uuid)
RETURNS TABLE (
  changed_at   timestamptz,
  txid         bigint,
  table_name   text,
  row_id       text,
  op           text,
  changed_cols text[],
  old_vals     jsonb,
  new_vals     jsonb,
  actor        text,
  actor_source text,
  actor_name   text,
  actor_role   text,
  subject      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cid AS (SELECT p_class_id::text AS t),
  keys AS (
    SELECT 'classes'::text AS table_name, p_class_id::text AS row_id
    UNION ALL SELECT 'class_teachers',    ct.id::text FROM class_teachers ct    WHERE ct.class_id = p_class_id
    UNION ALL SELECT 'class_enrollments', ce.id::text FROM class_enrollments ce WHERE ce.class_id = p_class_id
    UNION ALL SELECT 'student_lists',     sl.id::text FROM student_lists sl     WHERE sl.class_id = p_class_id
    UNION ALL SELECT 'students',          ce.student_id::text FROM class_enrollments ce WHERE ce.class_id = p_class_id
  ),
  hits AS (
    SELECT h.* FROM record_history h JOIN keys k ON k.table_name = h.table_name AND k.row_id = h.row_id
    UNION
    SELECT h.* FROM record_history h, cid
     WHERE h.table_name IN ('class_teachers','class_enrollments','student_lists')
       AND (h.new_vals ->> 'class_id' = cid.t OR h.old_vals ->> 'class_id' = cid.t)
  )
  SELECT
    h.changed_at, h.txid, h.table_name, h.row_id, h.op, h.changed_cols, h.old_vals, h.new_vals,
    h.actor, h.actor_source,
    u.name AS actor_name, u.role AS actor_role,
    CASE h.table_name
      WHEN 'students'          THEN (SELECT s.student_name FROM students s WHERE s.id::text = h.row_id)
      WHEN 'class_enrollments' THEN (SELECT s.student_name FROM class_enrollments ce JOIN students s ON s.id = ce.student_id WHERE ce.id::text = h.row_id)
      WHEN 'class_teachers'    THEN (SELECT tu.name FROM class_teachers ct JOIN users tu ON tu.id = ct.teacher_user_id WHERE ct.id::text = h.row_id)
      WHEN 'student_lists'     THEN (SELECT lu.name FROM student_lists sl JOIN users lu ON lu.id = sl.user_id WHERE sl.id::text = h.row_id)
      ELSE NULL
    END AS subject
  FROM hits h
  -- CASE, not AND: the planner may evaluate the cast before the regex guard and
  -- fail on 'authenticator'. CASE guarantees the order.
  LEFT JOIN users u
    ON u.id = CASE WHEN h.actor ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN h.actor::uuid END
  ORDER BY h.changed_at, h.id
$$;

REVOKE ALL ON FUNCTION public.roster_class_timeline(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_class_timeline(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- DOWN: row_history_actor_rollback.sql
