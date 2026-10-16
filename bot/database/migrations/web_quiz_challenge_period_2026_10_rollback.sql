-- Rollback of web_quiz_challenge_period_2026_10.sql: deletes the 2026-10 challenge_periods row, and only that row.
-- Refuses (raises, nothing deleted) while a web_quiz_challenge_runs or challenge_draws row names the period, or a
-- challenge_links window does: a counted row must keep the period it was counted in. No other row is touched.
-- No BEGIN/COMMIT: the tool that applies migrations owns the transaction.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.web_quiz_challenge_runs WHERE period_id = '2026-10') THEN
    RAISE EXCEPTION 'challenge period 2026-10 is named by web_quiz_challenge_runs rows: not deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.challenge_draws WHERE period_id = '2026-10') THEN
    RAISE EXCEPTION 'challenge period 2026-10 is named by challenge_draws rows: not deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.challenge_links WHERE window_from = '2026-10' OR window_to = '2026-10') THEN
    RAISE EXCEPTION 'challenge period 2026-10 is named by challenge_links rows: not deleted';
  END IF;
  DELETE FROM public.challenge_periods WHERE period_id = '2026-10';
END $$;
