-- V1.10.12 — the A/B ledger: every test in the database from the moment it is decided (bd-9nb6s0.2, epic bd-9nb6s0).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations. Needs V1.10.7.
--
-- WHY. The 26 Nov shared-infra review (Haroon, Fahad, Amena): a test is written to the database the moment someone
-- decides to run it, never to a file on one laptop; hooks move its status planned -> running -> concluded (winner);
-- the winner, and the arm that ships on a tie, are declared before anyone sees results; and an agent checks past tests
-- before a new one starts. Schema-first (Rule 15): ab_card_lock already holds one row per test, so the ledger is
-- fourteen more columns on it, not a new table.
--   description  one plain line any agent can read (the card's `testing` question)
--   status       planned (card frozen) -> running (first unit assigned) -> concluded (a call written)
--   winner       the arm that won (or the default arm when the call is not a roll-out); default_arm declared up front
--   switch_key   the app_settings key that turns the test on (the card's flag_key, ab_...)
--   owner, feature, arm_a, arm_b, launch_date, planned_n (units the card sized for), current_n (units assigned)
--   call, called_at  the machine call decide.py wrote, and when
-- WRITES (15 s each, ab_card_lock only):
--   ab_ledger_upsert(row)          card.py freeze: inserts the planned row; a running/concluded test is never rewound
--   ab_ledger_call(test, call, w)  decide.py, on the read date: writes the call once; a second call is refused
--   ab_ledger_advance()            the tracker cron, after a rollup that ran: counts units, moves the statuses
-- READ (30 s): ab_ledger_past_tests(feature, metric) for find.py.
-- DATA CLASSIFICATION (D6): '[Internal]'. owner is the card's owner label (a role or a team name), never a phone or email.
-- SECURITY. As V1.10.7: service_role only; functions SECURITY INVOKER.
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE. Rollback: ROLLBACK_V1.10.12__ab_ledger.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE public.ab_card_lock
  ADD COLUMN IF NOT EXISTS description TEXT CHECK (description IS NULL OR length(description) BETWEEN 1 AND 300),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'concluded')),
  ADD COLUMN IF NOT EXISTS winner TEXT CHECK (winner IS NULL OR winner ~ '^[a-z0-9_]{1,24}$'),
  ADD COLUMN IF NOT EXISTS default_arm TEXT CHECK (default_arm IS NULL OR default_arm ~ '^[a-z0-9_]{1,24}$'),
  ADD COLUMN IF NOT EXISTS switch_key TEXT CHECK (switch_key IS NULL OR switch_key ~ '^ab_[a-z0-9_]{1,60}$'),
  ADD COLUMN IF NOT EXISTS owner TEXT CHECK (owner IS NULL OR length(owner) BETWEEN 1 AND 80),
  ADD COLUMN IF NOT EXISTS feature TEXT CHECK (feature IS NULL OR length(feature) BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS arm_a TEXT CHECK (arm_a IS NULL OR length(arm_a) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS arm_b TEXT CHECK (arm_b IS NULL OR length(arm_b) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS launch_date DATE,
  ADD COLUMN IF NOT EXISTS planned_n INTEGER CHECK (planned_n IS NULL OR planned_n > 0),
  ADD COLUMN IF NOT EXISTS current_n INTEGER NOT NULL DEFAULT 0 CHECK (current_n >= 0),
  ADD COLUMN IF NOT EXISTS call TEXT CHECK (call IS NULL OR call ~ '^[a-z_]{1,40}$'),
  ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ab_card_lock_status ON public.ab_card_lock (status);

COMMENT ON TABLE public.ab_card_lock IS '[Internal] A/B tracker and ledger: one row per test from the moment it is frozen (planned -> running -> concluded), with its card hash, arms, default, switch, call and winner.';
COMMENT ON COLUMN public.ab_card_lock.status IS 'planned (card frozen) -> running (first unit assigned) -> concluded (a call written). Moved by ab_ledger_advance.';
COMMENT ON COLUMN public.ab_card_lock.default_arm IS 'The arm that ships when the call is not a roll-out; declared at freeze, before any result.';

-- card.py freeze. p_row carries the card's fields; the row is inserted as planned. A test already running or
-- concluded is left alone (the conflict update only touches a planned row), so a re-freeze can never rewind it.
CREATE OR REPLACE FUNCTION public.ab_ledger_upsert(p_row jsonb) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET statement_timeout = '15s'
  AS $$
DECLARE
  v_status text;
BEGIN
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ab_ledger_upsert: the row must be an object'; END IF;
  INSERT INTO public.ab_card_lock AS c
         (test_id, sha256, unit_kind, metric_ids, start_on, read_on, description, status, default_arm, switch_key,
          owner, feature, arm_a, arm_b, launch_date, planned_n)
  SELECT x.test_id, x.sha256, x.unit_kind, x.metric_ids, x.start_on, x.read_on, x.description, 'planned', x.default_arm,
         x.switch_key, x.owner, x.feature, x.arm_a, x.arm_b, x.start_on, x.planned_n
    FROM jsonb_to_record(p_row) AS x(test_id text, sha256 text, unit_kind text, metric_ids text[], start_on date,
                                     read_on date, description text, default_arm text, switch_key text, owner text,
                                     feature text, arm_a text, arm_b text, planned_n integer)
  ON CONFLICT (test_id) DO UPDATE
     SET sha256 = EXCLUDED.sha256, unit_kind = EXCLUDED.unit_kind, metric_ids = EXCLUDED.metric_ids,
         start_on = EXCLUDED.start_on, read_on = EXCLUDED.read_on, description = EXCLUDED.description,
         default_arm = EXCLUDED.default_arm, switch_key = EXCLUDED.switch_key, owner = EXCLUDED.owner,
         feature = EXCLUDED.feature, arm_a = EXCLUDED.arm_a, arm_b = EXCLUDED.arm_b,
         launch_date = EXCLUDED.launch_date, planned_n = EXCLUDED.planned_n, updated_at = now()
   WHERE c.status = 'planned';
  SELECT c.status INTO v_status FROM public.ab_card_lock c WHERE c.test_id = p_row ->> 'test_id';
  RETURN v_status;
END;
$$;

-- decide.py on the read date. Written once: the call is the data's, and nobody re-calls a test after seeing it.
CREATE OR REPLACE FUNCTION public.ab_ledger_call(p_test_id text, p_call text, p_winner text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET statement_timeout = '15s'
  AS $$
BEGIN
  UPDATE public.ab_card_lock AS c
     SET call = p_call, winner = coalesce(p_winner, c.default_arm), called_at = now(), updated_at = now()
   WHERE c.test_id = p_test_id AND c.call IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ab_ledger_call: % is not in the ledger or already has a call', p_test_id;
  END IF;
END;
$$;

-- The tracker cron, after a rollup that ran. Counts each test's units, then moves the statuses. Returns the counts.
CREATE OR REPLACE FUNCTION public.ab_ledger_advance() RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET statement_timeout = '15s'
  AS $$
DECLARE
  v_counted integer;
  v_running integer;
  v_concluded integer;
BEGIN
  UPDATE public.ab_card_lock AS c
     SET current_n = n.units, updated_at = now()
    FROM (SELECT l.test_id, (SELECT count(*) FROM public.ab_assignment a WHERE a.test_id = l.test_id)::integer AS units
            FROM public.ab_card_lock l WHERE l.status <> 'concluded') n
   WHERE c.test_id = n.test_id AND c.current_n IS DISTINCT FROM n.units;
  GET DIAGNOSTICS v_counted = ROW_COUNT;

  UPDATE public.ab_card_lock AS c
     SET status = 'running', updated_at = now()
   WHERE c.status = 'planned' AND c.current_n > 0;
  GET DIAGNOSTICS v_running = ROW_COUNT;

  UPDATE public.ab_card_lock AS c
     SET status = 'concluded', updated_at = now()
   WHERE c.status = 'running' AND c.call IS NOT NULL;
  GET DIAGNOSTICS v_concluded = ROW_COUNT;

  RETURN jsonb_build_object('counted', v_counted, 'running', v_running, 'concluded', v_concluded);
END;
$$;

-- find.py, before a new test: what past tests on the same feature or measure did. Newest first, at most 50.
CREATE OR REPLACE FUNCTION public.ab_ledger_past_tests(p_feature text DEFAULT NULL, p_metric text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY INVOKER SET statement_timeout = '30s'
  AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.launch_date DESC NULLS LAST, r.test_id), '[]'::jsonb)
    FROM (SELECT c.test_id, c.description, c.status, c.feature, c.owner, c.arm_a, c.arm_b, c.default_arm, c.winner,
                 c.call, c.called_at, c.launch_date, c.read_on, c.planned_n, c.current_n, c.metric_ids, c.switch_key
            FROM public.ab_card_lock c
           WHERE (p_feature IS NULL OR c.feature ILIKE '%' || p_feature || '%')
             AND (p_metric IS NULL OR p_metric = ANY (c.metric_ids))
           ORDER BY c.launch_date DESC NULLS LAST, c.test_id
           LIMIT 50) r
$$;

REVOKE ALL ON FUNCTION public.ab_ledger_upsert(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_ledger_upsert(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ab_ledger_call(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_ledger_call(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ab_ledger_advance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_ledger_advance() TO service_role;
REVOKE ALL ON FUNCTION public.ab_ledger_past_tests(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_ledger_past_tests(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
