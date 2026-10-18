-- Reverse of V1.6.15. Deletes fln rows from niete_lp_opens, restores the two-value plan_kind CHECK
-- ('k5','g612') and drops niete_fln_events with its index.
-- destructive: reviewed — niete_lp_opens 'fln' rows are portal opens of FLN lesson plans (ids and
-- timestamps only) and niete_fln_events holds keyed-id usage events; losing them loses FLN usage
-- history, nothing else reads them.
-- SAFE ONLY after the code is rolled back: the FLN routes and lp-activity.service write both.
-- Roll the CODE back first. Idempotent. One RPC call from the migration runner = one transaction.
DELETE FROM niete_lp_opens WHERE plan_kind = 'fln';
ALTER TABLE niete_lp_opens DROP CONSTRAINT IF EXISTS niete_lp_opens_plan_kind_check;
ALTER TABLE niete_lp_opens ADD CONSTRAINT niete_lp_opens_plan_kind_check
  CHECK (plan_kind IN ('k5', 'g612'));
DROP INDEX IF EXISTS niete_fln_events_created_idx;
DROP TABLE IF EXISTS niete_fln_events;
NOTIFY pgrst, 'reload schema';
