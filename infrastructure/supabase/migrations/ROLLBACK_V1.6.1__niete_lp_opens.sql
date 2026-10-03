-- Reverse of V1.6.1. Drops niete_lp_opens and its index.
-- destructive: reviewed — the table holds only ids, a language code and timestamps of portal
-- lesson-plan opens. Dropping it loses "last opened" history and the portal half of the Home's
-- lesson-plans-used count; nothing else reads it.
-- SAFE ONLY after the code is rolled back: dashboard/services/lp-activity.service.js writes and reads
-- it (the write is fire-and-forget, so an open would not fail, but every write would log an error).
-- Roll the CODE back first.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.
DROP INDEX IF EXISTS idx_lp_opens_user_recent;
DROP TABLE IF EXISTS niete_lp_opens;
NOTIFY pgrst, 'reload schema';
