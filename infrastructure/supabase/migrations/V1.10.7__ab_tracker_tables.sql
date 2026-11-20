-- V1.10.7 — the A/B tracker's own small tables, its nightly reads and its writes (docs/ab-tracker-store.md).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. The workspace's A/B tracker keeps its numbers in this database (decided 20 Nov 2026), in five small tables of
-- its own, all prefixed ab_ in public, beside nothing else. One job a night on the bot's worker reads the app's rows on
-- the READ REPLICA only (two read functions below, 30 s each) and writes these tables only (three write functions,
-- 15 s each). The job is off until app_settings ab_tracker_rollup_enabled is set.
--   ab_card_lock           one row per launched test: its frozen card hash, unit kind, measures and dates
--   ab_assignment          one row per unit of a test: its arm (and draw block) — every test, hash split or drawn
--   ab_refresh_log         one row per nightly run: status, counts, timings
--   ab_rollup_unit_period  test x unit x measure x day-or-week: n, sum, sum of squares (enough for a mean and an SD)
--   ab_stop_state          per test and stop rule: tripped, reviewed or clear (written by the workspace's stop check)
-- The existing per-test tables (niete_lp_ab_assignment, niete_coaching_ab_assignment) are live tests' and untouched.
-- No foreign key, trigger or write reaches an app table: the tracker can never lock, cascade into or slow an app row.
-- unit_id is a school or a teacher id on purpose WITHOUT a REFERENCES (D3 exception, reviewed): the tracker must not
-- hold a key on the app's users or schools.
-- DATA CLASSIFICATION (D6): '[Internal]' — test ids, unit ids, arm labels and counts. No name, phone or mark.
-- OWNER (D7): the workspace A/B tracker (ab-testing skill), on the NIETE-Rumi platform.
-- DATA. Five new empty tables. LOAD. Reads: one call per test and measure a night, each bounded to a few days and the
-- test's own units, on the replica. Writes: upserts of at most 2,000 rows a call, one call at a time.
-- SECURITY. RLS on with no policy and no grant to anon/authenticated: service_role only. Functions SECURITY INVOKER,
-- EXECUTE for service_role only.
-- IDEMPOTENT. IF NOT EXISTS / CREATE OR REPLACE throughout. Rollback: ROLLBACK_V1.10.7__ab_tracker_tables.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS public.ab_card_lock (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id     TEXT NOT NULL UNIQUE CHECK (test_id ~ '^[a-z0-9]+(-[a-z0-9]+)+$'),
  sha256      TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  unit_kind   TEXT NOT NULL CHECK (unit_kind IN ('school', 'teacher')),
  metric_ids  TEXT[] NOT NULL CHECK (cardinality(metric_ids) BETWEEN 1 AND 12),
  start_on    DATE NOT NULL,
  read_on     DATE NOT NULL CHECK (read_on >= start_on),
  ended_at    TIMESTAMPTZ,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ab_assignment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id      TEXT NOT NULL REFERENCES public.ab_card_lock(test_id) ON DELETE CASCADE,
  unit_id      UUID NOT NULL,
  arm          TEXT NOT NULL CHECK (arm ~ '^[a-z0-9_]{1,24}$'),
  block        TEXT,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ab_assignment_unit UNIQUE (test_id, unit_id)
);

CREATE TABLE IF NOT EXISTS public.ab_refresh_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status         TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ran', 'partial', 'failed')),
  tests          INTEGER NOT NULL DEFAULT 0 CHECK (tests >= 0),
  watermark      DATE,
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ab_rollup_unit_period (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id      TEXT NOT NULL REFERENCES public.ab_card_lock(test_id) ON DELETE CASCADE,
  arm          TEXT NOT NULL,
  unit_id      UUID NOT NULL,
  block        TEXT,
  period_kind  TEXT NOT NULL CHECK (period_kind IN ('day', 'week')),
  period       DATE NOT NULL,
  metric_id    TEXT NOT NULL,
  n bigint NOT NULL CHECK (n >= 0), s double precision NOT NULL, ss double precision NOT NULL,
  refresh_id   UUID NOT NULL REFERENCES public.ab_refresh_log(id),
  pulled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ab_rollup_unit_period_grain UNIQUE (test_id, unit_id, metric_id, period_kind, period)
);
CREATE INDEX IF NOT EXISTS idx_ab_rollup_test_metric_period
  ON public.ab_rollup_unit_period (test_id, metric_id, period);

CREATE TABLE IF NOT EXISTS public.ab_stop_state (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id           TEXT NOT NULL REFERENCES public.ab_card_lock(test_id) ON DELETE CASCADE,
  rule_id           TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('tripped', 'reviewed', 'clear')),
  value             DOUBLE PRECISION,
  threshold         DOUBLE PRECISION,
  reviewed_by_role  TEXT CHECK (reviewed_by_role IS NULL OR reviewed_by_role IN ('owner', 'second_reader')),
  as_of             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ab_stop_state_rule UNIQUE (test_id, rule_id)
);

ALTER TABLE public.ab_card_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_refresh_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_rollup_unit_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_stop_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ab_card_lock FROM anon, authenticated;
REVOKE ALL ON public.ab_assignment FROM anon, authenticated;
REVOKE ALL ON public.ab_refresh_log FROM anon, authenticated;
REVOKE ALL ON public.ab_rollup_unit_period FROM anon, authenticated;
REVOKE ALL ON public.ab_stop_state FROM anon, authenticated;

COMMENT ON TABLE public.ab_card_lock IS '[Internal] A/B tracker: one row per launched test (frozen card hash, unit kind, measures, dates).';
COMMENT ON TABLE public.ab_assignment IS '[Internal] A/B tracker: each unit''s arm in a test (unit ids only).';
COMMENT ON TABLE public.ab_refresh_log IS '[Internal] A/B tracker: one row per nightly rollup run.';
COMMENT ON TABLE public.ab_rollup_unit_period IS '[Internal] A/B tracker: test x unit x measure x day/week sums (n, s, ss).';
COMMENT ON TABLE public.ab_stop_state IS '[Internal] A/B tracker: stop-rule state per test.';

-- READS — run by the nightly job on the read replica. Pakistan dates. Each call is bounded to one test's own units.
CREATE OR REPLACE FUNCTION public.ab_tracker_live_tests() RETURNS jsonb
  LANGUAGE sql STABLE SECURITY INVOKER SET statement_timeout = '30s'
  AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'test_id', c.test_id, 'unit_kind', c.unit_kind, 'metric_ids', to_jsonb(c.metric_ids),
           'start_on', c.start_on, 'read_on', c.read_on,
           'units', (SELECT count(*) FROM public.ab_assignment a WHERE a.test_id = c.test_id)) ORDER BY c.test_id), '[]'::jsonb)
    FROM public.ab_card_lock c
   WHERE c.ended_at IS NULL
     AND c.start_on <= (now() AT TIME ZONE 'Asia/Karachi')::date
     AND c.read_on + 14 >= (now() AT TIME ZONE 'Asia/Karachi')::date
$$;

-- The test's teachers: a school unit = the school's teachers; a teacher unit = the teacher. Deleted and test accounts
-- out. Plain STABLE SQL with no SET, so the planner inlines it into each measure's query (indexes on users stay usable).
CREATE OR REPLACE FUNCTION public.ab_tracker_unit_teachers(p_test_id text, p_kind text)
  RETURNS TABLE (teacher_id uuid, unit_id uuid, arm text, block text)
  LANGUAGE sql STABLE SECURITY INVOKER
  AS $$
  SELECT u.id, a.unit_id, a.arm, a.block
    FROM public.ab_assignment a JOIN public.users u ON u.school_id = a.unit_id
   WHERE p_kind = 'school' AND a.test_id = p_test_id AND u.role = 'teacher' AND u.deleted_at IS NULL AND u.is_test_user IS NOT TRUE
  UNION ALL
  SELECT u.id, a.unit_id, a.arm, a.block
    FROM public.ab_assignment a JOIN public.users u ON u.id = a.unit_id
   WHERE p_kind = 'teacher' AND a.test_id = p_test_id AND u.role = 'teacher' AND u.deleted_at IS NULL AND u.is_test_user IS NOT TRUE
$$;

-- One test x one measure x a window of Pakistan days -> jsonb rows {arm, unit_id, block, period_kind, period, n, s, ss}.
-- The measures (workspace catalogue .claude/skills/ab-testing/reference/metrics/<id>.sql says the same):
--   plan_fidelity                  unit x day: scored lesson-plan fidelity of AI-coach and coach-visit sessions (0-100)
--   teachers_coming_back           unit x week (Monday): distinct teachers who took a plan (WhatsApp send or app open)
--   child_quiz_objectives_secured  unit x day, child level: each child's share of quiz objectives secured that day
--   send_failures                  unit x day: lesson-plan sends, 1 = failed (a stop-rule measure)
CREATE OR REPLACE FUNCTION public.ab_tracker_metric_rows(p_test_id text, p_metric_id text, p_from date, p_to date)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY INVOKER SET statement_timeout = '30s'
  AS $$
DECLARE
  v_kind text;
  v_from timestamptz := (p_from::timestamp AT TIME ZONE 'Asia/Karachi');
  v_to   timestamptz := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Karachi');
  v_out  jsonb;
BEGIN
  SELECT c.unit_kind INTO v_kind FROM public.ab_card_lock c WHERE c.test_id = p_test_id;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'ab_tracker_metric_rows: unknown test %', p_test_id; END IF;
  IF p_to < p_from OR p_to - p_from > 62 THEN RAISE EXCEPTION 'ab_tracker_metric_rows: the window must be 1 to 63 days'; END IF;

  IF p_metric_id = 'plan_fidelity' THEN
    WITH t AS (SELECT * FROM public.ab_tracker_unit_teachers(p_test_id, v_kind)), x AS (
      SELECT t.arm, t.unit_id, t.block, (c.created_at AT TIME ZONE 'Asia/Karachi')::date AS d,
             (c.analysis_data #>> '{lp_fidelity,fidelity_pct}')::double precision AS v
        FROM t JOIN public.coaching_sessions c ON c.user_id = t.teacher_id
       WHERE c.created_at >= v_from AND c.created_at < v_to
         AND (c.observation_type IS NULL OR c.observation_type = 'leader_observation')
         AND c.analysis_data #>> '{lp_fidelity,status}' = 'ok'
         AND jsonb_typeof(c.analysis_data #> '{lp_fidelity,fidelity_pct}') = 'number'
    )
    SELECT coalesce(jsonb_agg(r ORDER BY r.unit_id, r.period), '[]'::jsonb) INTO v_out FROM (
      SELECT x.arm, x.unit_id, x.block, 'day' AS period_kind, x.d AS period, count(*) AS n, sum(x.v) AS s, sum(x.v * x.v) AS ss
        FROM x GROUP BY x.arm, x.unit_id, x.block, x.d) r;

  ELSIF p_metric_id = 'teachers_coming_back' THEN
    WITH t AS (SELECT * FROM public.ab_tracker_unit_teachers(p_test_id, v_kind)), took AS (
      SELECT d.user_id AS teacher_id, d.created_at AS at
        FROM t JOIN public.niete_lp_downloads d ON d.user_id = t.teacher_id
       WHERE d.status = 'sent' AND d.created_at >= v_from AND d.created_at < v_to
      UNION ALL
      SELECT o.user_id, o.opened_at
        FROM t JOIN public.niete_lp_opens o ON o.user_id = t.teacher_id
       WHERE o.plan_kind = 'k5' AND o.source IN ('viewer', 'external') AND o.opened_at >= v_from AND o.opened_at < v_to
    ), wk AS (
      SELECT DISTINCT took.teacher_id, date_trunc('week', took.at AT TIME ZONE 'Asia/Karachi')::date AS wk FROM took
    )
    SELECT coalesce(jsonb_agg(r ORDER BY r.unit_id, r.period), '[]'::jsonb) INTO v_out FROM (
      SELECT t.arm, t.unit_id, t.block, 'week' AS period_kind, wk.wk AS period, 1 AS n,
             count(*)::double precision AS s, (count(*) * count(*))::double precision AS ss
        FROM wk JOIN t ON t.teacher_id = wk.teacher_id GROUP BY t.arm, t.unit_id, t.block, wk.wk) r;

  ELSIF p_metric_id = 'child_quiz_objectives_secured' THEN
    WITH t AS (SELECT * FROM public.ab_tracker_unit_teachers(p_test_id, v_kind)), s AS (
      SELECT t.arm, t.unit_id, t.block, qs.id AS session_id, qs.student_id,
             (qs.created_at AT TIME ZONE 'Asia/Karachi')::date AS d
        FROM t JOIN public.quizzes q ON q.teacher_id = t.teacher_id
        JOIN public.quiz_sessions qs ON qs.quiz_id = q.id
       WHERE qs.created_at >= v_from AND qs.created_at < v_to
         AND qs.invited_by_student_id IS NULL AND qs.student_id IS NOT NULL
         AND (qs.user_id IS NULL OR qs.user_id <> q.teacher_id)
    ), obj AS (
      SELECT s.arm, s.unit_id, s.block, s.d, s.student_id, split_part(qq.external_id, ':', 3) AS objective,
             bool_and(coalesce(a.is_correct, false)) AS secured
        FROM s JOIN public.quiz_answers a ON a.session_id = s.session_id
        JOIN public.quiz_questions qq ON qq.id = a.question_id
       WHERE qq.external_id LIKE 'tq:%'
       GROUP BY s.arm, s.unit_id, s.block, s.d, s.student_id, split_part(qq.external_id, ':', 3)
    ), kid AS (
      SELECT obj.arm, obj.unit_id, obj.block, obj.d, obj.student_id,
             avg(CASE WHEN obj.secured THEN 1.0 ELSE 0.0 END)::double precision AS v
        FROM obj GROUP BY obj.arm, obj.unit_id, obj.block, obj.d, obj.student_id
    )
    SELECT coalesce(jsonb_agg(r ORDER BY r.unit_id, r.period), '[]'::jsonb) INTO v_out FROM (
      SELECT kid.arm, kid.unit_id, kid.block, 'day' AS period_kind, kid.d AS period, count(*) AS n,
             sum(kid.v) AS s, sum(kid.v * kid.v) AS ss
        FROM kid GROUP BY kid.arm, kid.unit_id, kid.block, kid.d) r;

  ELSIF p_metric_id = 'send_failures' THEN
    WITH t AS (SELECT * FROM public.ab_tracker_unit_teachers(p_test_id, v_kind)), x AS (
      SELECT t.arm, t.unit_id, t.block, (d.created_at AT TIME ZONE 'Asia/Karachi')::date AS d,
             CASE WHEN d.status = 'sent' THEN 0.0 ELSE 1.0 END::double precision AS v
        FROM t JOIN public.niete_lp_downloads d ON d.user_id = t.teacher_id
       WHERE d.created_at >= v_from AND d.created_at < v_to
    )
    SELECT coalesce(jsonb_agg(r ORDER BY r.unit_id, r.period), '[]'::jsonb) INTO v_out FROM (
      SELECT x.arm, x.unit_id, x.block, 'day' AS period_kind, x.d AS period, count(*) AS n, sum(x.v) AS s, sum(x.v * x.v) AS ss
        FROM x GROUP BY x.arm, x.unit_id, x.block, x.d) r;

  ELSE
    RAISE EXCEPTION 'ab_tracker_metric_rows: unknown metric %', p_metric_id;
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.ab_tracker_unit_teachers(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_tracker_unit_teachers(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ab_tracker_live_tests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_tracker_live_tests() TO service_role;
REVOKE ALL ON FUNCTION public.ab_tracker_metric_rows(text, text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_tracker_metric_rows(text, text, date, date) TO service_role;

-- WRITES — run by the nightly job on the primary, one call at a time. They touch the ab_ tables only.
CREATE OR REPLACE FUNCTION public.ab_tracker_refresh_open(p_tests integer, p_watermark date) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET statement_timeout = '15s'
  AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.ab_refresh_log (status, tests, watermark)
  VALUES ('running', greatest(coalesce(p_tests, 0), 0), p_watermark)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ab_tracker_upsert_rollup(p_refresh_id uuid, p_rows jsonb) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET statement_timeout = '15s'
  AS $$
DECLARE
  v_n integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 2000 THEN
    RAISE EXCEPTION 'ab_tracker_upsert_rollup: rows must be a list of at most 2000';
  END IF;
  INSERT INTO public.ab_rollup_unit_period AS r
         (test_id, arm, unit_id, block, period_kind, period, metric_id, n, s, ss, refresh_id, pulled_at)
  SELECT x.test_id, x.arm, x.unit_id, x.block, x.period_kind, x.period, x.metric_id, x.n, x.s, x.ss, p_refresh_id, now()
    FROM jsonb_to_recordset(p_rows) AS x(test_id text, arm text, unit_id uuid, block text, period_kind text,
                                         period date, metric_id text, n bigint, s double precision, ss double precision)
  ON CONFLICT (test_id, unit_id, metric_id, period_kind, period) DO UPDATE
     SET arm = EXCLUDED.arm, block = EXCLUDED.block, n = EXCLUDED.n, s = EXCLUDED.s, ss = EXCLUDED.ss,
         refresh_id = EXCLUDED.refresh_id, pulled_at = EXCLUDED.pulled_at, updated_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.ab_tracker_refresh_close(p_refresh_id uuid, p_status text, p_detail jsonb) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET statement_timeout = '15s'
  AS $$
BEGIN
  UPDATE public.ab_refresh_log
     SET status = p_status, detail = coalesce(p_detail, '{}'::jsonb), finished_at = now(), updated_at = now()
   WHERE id = p_refresh_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ab_tracker_refresh_close: no refresh %', p_refresh_id; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ab_tracker_refresh_open(integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_tracker_refresh_open(integer, date) TO service_role;
REVOKE ALL ON FUNCTION public.ab_tracker_upsert_rollup(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_tracker_upsert_rollup(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ab_tracker_refresh_close(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_tracker_refresh_close(uuid, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
