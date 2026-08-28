-- 025_fix_mv_dashboard_stats_refresh.sql
--
-- WHY (bd-ri5o9.7) — applied live to NIETE prod + staging on 2026-08-28 during
-- the morning outage; this file makes the change reproducible.
--
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats` had been failing
-- on EVERY attempt since at least 21 August -- roughly 1,150 errors a day --
-- and mv_dashboard_stats had not successfully refreshed since 11 JULY. Nobody
-- noticed because refresh_dashboard_views() catches the exception per view and
-- returns it as a row nobody reads, so the dashboard just showed seven-week-old
-- numbers.
--
-- ROOT CAUSE: migration 024 satisfied "CONCURRENTLY needs a unique index" with
--     CREATE UNIQUE INDEX ... ON mv_dashboard_stats USING btree ((1))
-- an index on a constant EXPRESSION. Postgres requires the unique index to be on
-- one or more COLUMNS -- its hint says so verbatim: "Create a unique index with
-- no WHERE clause on one or more columns of the materialized view." So the index
-- existed, looked right in every listing, and could never qualify.
--
-- SECOND, LARGER RISK this migration also closes: with the refresh FIXED it now
-- actually runs instead of failing in microseconds. Production logs show FOUR
-- callers per ~5-minute tick, one second apart -- the dashboard's replicas, with
-- no single-flight. Concurrent long refreshes stacking is the precise mechanism
-- that wedged this database on 24/25 August. Fixing the index without adding the
-- guard would have armed that. pg_try_advisory_xact_lock is xact-scoped on
-- purpose: the transaction pooler (6543) offers no session continuity, so a
-- session-scoped lock could never be released reliably.
--
-- Measured after the fix (prod, 2026-08-28): mv_dashboard_stats 170ms,
-- mv_users_activity 858ms, mv_retention_cohorts 539ms, mv_view_refresh_status
-- 19ms -- ~1.6s total against a 5-minute cadence.
--
-- Verified on staging first (5 concurrent callers: 2 correctly skipped).

BEGIN;

-- 1 · a unique index on a COLUMN. The view is a single-row aggregate, so
--     last_refreshed is unique by construction and never null.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dashboard_stats_key
  ON public.mv_dashboard_stats (last_refreshed);

-- 2 · retire the expression index that could never satisfy CONCURRENTLY.
DROP INDEX IF EXISTS public.idx_mv_dashboard_stats_unique;

COMMIT;

-- 3 · single-flight + visible failures.
CREATE OR REPLACE FUNCTION public.refresh_dashboard_views()
 RETURNS TABLE(view_name text, refresh_status text, duration_ms integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  start_time TIMESTAMP;
  end_time TIMESTAMP;
BEGIN
  -- SINGLE-FLIGHT (bd-ri5o9.7). The dashboard runs multiple replicas and every
  -- one of them called this on the same ~5-minute tick: production logs show
  -- four invocations a second apart, ~1,150 a day. While the refresh failed
  -- instantly that was merely noisy; now that it actually runs, concurrent
  -- callers would stack long transactions on top of each other -- which is the
  -- precise mechanism that wedged this database on 24/25 Aug.
  --
  -- xact-scoped on purpose: the transaction pooler (6543) gives no session
  -- continuity, so a session-scoped lock could never be released reliably.
  -- Auto-releases at transaction end, including on error.
  IF NOT pg_try_advisory_xact_lock(hashtext('refresh_dashboard_views')::bigint) THEN
    RETURN QUERY SELECT 'all'::TEXT, 'skipped: refresh already running'::TEXT, 0;
    RETURN;
  END IF;

  start_time := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats;
    end_time := clock_timestamp();
    RETURN QUERY SELECT 'mv_dashboard_stats'::TEXT, 'success'::TEXT,
      EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    -- Still caught so one bad view cannot stop the rest, but RAISE WARNING makes
    -- it visible: the silent swallow is why mv_dashboard_stats sat unrefreshed
    -- from 11 July to 28 August without anyone noticing.
    RAISE WARNING 'refresh_dashboard_views: mv_dashboard_stats failed: %', SQLERRM;
    RETURN QUERY SELECT 'mv_dashboard_stats'::TEXT, SQLERRM::TEXT, 0;
  END;

  start_time := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_users_activity;
    end_time := clock_timestamp();
    RETURN QUERY SELECT 'mv_users_activity'::TEXT, 'success'::TEXT,
      EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'refresh_dashboard_views: mv_users_activity failed: %', SQLERRM;
    RETURN QUERY SELECT 'mv_users_activity'::TEXT, SQLERRM::TEXT, 0;
  END;

  start_time := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_retention_cohorts;
    end_time := clock_timestamp();
    RETURN QUERY SELECT 'mv_retention_cohorts'::TEXT, 'success'::TEXT,
      EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'refresh_dashboard_views: mv_retention_cohorts failed: %', SQLERRM;
    RETURN QUERY SELECT 'mv_retention_cohorts'::TEXT, SQLERRM::TEXT, 0;
  END;

  start_time := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_view_refresh_status;
    end_time := clock_timestamp();
    RETURN QUERY SELECT 'mv_view_refresh_status'::TEXT, 'success'::TEXT,
      EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'refresh_dashboard_views: mv_view_refresh_status failed: %', SQLERRM;
    RETURN QUERY SELECT 'mv_view_refresh_status'::TEXT, SQLERRM::TEXT, 0;
  END;
END;
$function$;

-- DOWN (restores the previous, broken state -- kept for completeness only):
--   DROP INDEX IF EXISTS public.idx_mv_dashboard_stats_key;
--   CREATE UNIQUE INDEX idx_mv_dashboard_stats_unique
--     ON public.mv_dashboard_stats USING btree ((1));
--   -- and restore refresh_dashboard_views() without the advisory lock.
