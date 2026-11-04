-- ROLLBACK_V1.8.9 — reverse of migration V1.8.9 (bd-t8zeu9), Flyway-style rollback applied by migrate.js: turn row
-- level security back off on niete_lp_downloads and niete_lp612_deliveries.
-- The anon and authenticated grants are NOT given back, on purpose: no code reads either table with the anon key, and
-- re-granting would hand teacher phone numbers back to the public key. If a reader turns out to have needed them,
-- grant that one privilege to that one role by hand, never ALL to anon.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.niete_lp_downloads DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.niete_lp612_deliveries DISABLE ROW LEVEL SECURITY;
