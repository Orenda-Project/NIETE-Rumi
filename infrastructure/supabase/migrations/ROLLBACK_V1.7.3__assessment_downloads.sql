-- Reverse of V1.7.3. Drops assessment_downloads and its index.
-- destructive: reviewed — the table holds only ids, an artifact name and timestamps of portal paper
-- downloads. Dropping it loses the download history the paper-ask A/B (bd-ivsjk8) reads.
-- SAFE ONLY after the code is rolled back: dashboard/services/assessment-downloads.service.js writes
-- it (fire-and-forget, so a download would not fail, but every write would log an error).
-- Roll the CODE back first.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.
DROP INDEX IF EXISTS idx_assessment_downloads_user_recent;
DROP TABLE IF EXISTS assessment_downloads;
NOTIFY pgrst, 'reload schema';
