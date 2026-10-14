-- ROLLBACK V1.6.8 — drop the niete_lp_taken view (bd-2wgr3d.22.2).
-- The view holds no data: dropping it loses nothing. Roll back every reader that uses it first
-- (bd-2wgr3d.22.3, bd-2wgr3d.22.5), or those readers answer errors.

BEGIN;
DROP VIEW IF EXISTS public.niete_lp_taken;
COMMIT;

NOTIFY pgrst, 'reload schema';
