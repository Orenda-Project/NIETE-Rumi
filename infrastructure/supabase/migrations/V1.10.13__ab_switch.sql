-- V1.10.13 — the A/B switch: a concluded test's winner serves everyone (bd-9nb6s0.6, epic bd-9nb6s0). Needs V1.10.12.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. The 26 Nov shared-infra review: data decides, no human umpire. Once decide.py writes a call and the ledger
-- moves the test to concluded, the winner must reach every unit without someone remembering to flip a flag. The
-- tracker cron calls ab_ledger_switch() right after ab_ledger_advance(); it writes {winner, test_id} to the test's own
-- switch_key in app_settings, and ab-assign.service.js serves that winner to every unit.
-- FAIL CLOSED. The switch only writes app_settings when app_settings ab_switch_auto is JSON true. Otherwise (the key
-- missing, false, or anything else) it records switch_state = 'pending' and the exact SQL that does the flip in
-- switch_sql, for a person to run. This migration does not create ab_switch_auto: on production it stays absent.
-- Schema-first (Rule 15): three more columns on ab_card_lock, no new table.
--   switch_state  NULL (not yet) -> pending (waiting for a person) -> flipped (app_settings written)
--   switch_sql    the statement that flips it (run by hand when pending; kept as the record when flipped)
--   switched_at   when the flip was written by the switch
-- WRITES (15 s): ab_card_lock (switch columns) and app_settings (the switch_key row, only when ab_switch_auto).
-- DATA CLASSIFICATION (D6): '[Internal]'. No personal data.
-- SECURITY. As V1.10.12: service_role only; function SECURITY INVOKER.
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE. Rollback: ROLLBACK_V1.10.13__ab_switch.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE public.ab_card_lock
  ADD COLUMN IF NOT EXISTS switch_state text check (switch_state is null or switch_state in ('pending', 'flipped')),
  ADD COLUMN IF NOT EXISTS switch_sql TEXT CHECK (switch_sql IS NULL OR length(switch_sql) BETWEEN 1 AND 1000),
  ADD COLUMN IF NOT EXISTS switched_at TIMESTAMPTZ;

COMMENT ON COLUMN public.ab_card_lock.switch_state IS 'NULL -> pending (flip waits for a person: run switch_sql) -> flipped (winner written to switch_key). Set by ab_ledger_switch.';

-- The tracker cron, after ab_ledger_advance. Returns {flipped, pending, auto}.
CREATE OR REPLACE FUNCTION public.ab_ledger_switch() RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET statement_timeout = '15s'
  AS $$
DECLARE
  v_auto boolean;
  v_value jsonb;
  v_sql text;
  v_flipped integer := 0;
  v_pending integer := 0;
  v_n integer;
  r record;
BEGIN
  SELECT (s.value = 'true'::jsonb) INTO v_auto FROM public.app_settings s WHERE s.key = 'ab_switch_auto';
  v_auto := coalesce(v_auto, false);

  FOR r IN SELECT c.test_id, c.switch_key, c.winner
             FROM public.ab_card_lock c
            WHERE c.status = 'concluded' AND c.switch_key is not null AND c.winner is not null
              AND c.switch_state is distinct from 'flipped'
            ORDER BY c.test_id  -- no row lock: the cron has one caller per slot, and each UPDATE below locks its row
  LOOP
    v_value := jsonb_build_object('winner', r.winner, 'test_id', r.test_id);
    v_sql := format('INSERT INTO public.app_settings (key, value, description) VALUES (%L, %L::jsonb, %L) '
                    'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();',
                    r.switch_key, v_value::text, 'A/B switch: ' || r.test_id || ' concluded; its winner serves everyone.');
    IF v_auto THEN
      EXECUTE v_sql;
      UPDATE public.ab_card_lock AS c
         SET switch_state = 'flipped', switch_sql = v_sql, switched_at = now(), updated_at = now()
       WHERE c.test_id = r.test_id;
      v_flipped := v_flipped + 1;
    ELSE
      UPDATE public.ab_card_lock AS c
         SET switch_state = 'pending', switch_sql = v_sql, updated_at = now()
       WHERE c.test_id = r.test_id AND c.switch_state IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_pending := v_pending + v_n;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('flipped', v_flipped, 'pending', v_pending, 'auto', v_auto);
END;
$$;

REVOKE ALL ON FUNCTION public.ab_ledger_switch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ab_ledger_switch() TO service_role;

NOTIFY pgrst, 'reload schema';
