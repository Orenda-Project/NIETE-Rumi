-- V1.8.9 — row level security on niete_lp_downloads and niete_lp612_deliveries; anon and authenticated lose every
-- privilege on both.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. Neither table ever had RLS (018_niete_lp_assets_and_downloads, V1.5.5). niete_lp_downloads carries a phone
-- column. Staging grants anon and authenticated ALL on both tables, and sandbox grants them SELECT on
-- niete_lp_downloads, so the public anon key reads teacher phone numbers there. Prod grants anon nothing today; RLS is
-- the second lock that stops one stray GRANT from opening the table.
--
-- ACCESS. No policies, on purpose (the V1.6.19 / V1.8.7 convention): every reader bypasses RLS.
--   bot, workers, QA seed scripts   the service role (BYPASSRLS)
--   teacher/coach portal            its pg pool's login role, which is `postgres` (BYPASSRLS) on sandbox and staging
--   table owner                     app_owner (sandbox) or postgres, both BYPASSRLS
-- Any other role that holds a grant (app_rw, portal_app_user) sees no rows from now on. None of them reads these
-- tables. No view, materialized view or function is built on either table, so nothing reads around the RLS.
--
-- DATA. Sensitivity: restricted (phone) on niete_lp_downloads; internal on niete_lp612_deliveries. No row changes.
-- IDEMPOTENT. ENABLE ROW LEVEL SECURITY on a table that has it and REVOKE of a privilege not held are both no-ops.
-- Each ALTER TABLE takes a brief ACCESS EXCLUSIVE lock. lock_timeout is 5s, so behind a long transaction it fails
-- fast and is re-run, instead of queueing every reader behind it.
-- Rollback: ROLLBACK_V1.8.9__lp_downloads_rls.sql
-- ORDER. After V1.8.8. Needs both tables (018 and V1.5.5).

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.niete_lp_downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.niete_lp612_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.niete_lp_downloads FROM anon, authenticated;
REVOKE ALL ON TABLE public.niete_lp612_deliveries FROM anon, authenticated;
