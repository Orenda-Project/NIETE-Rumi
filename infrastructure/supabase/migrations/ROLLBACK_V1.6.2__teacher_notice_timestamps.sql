-- ROLLBACK V1.6.2 — teacher app v2 "ready" notice timestamps (reverses migration V1.6.2).
-- destructive: reviewed — drops only the four nullable timestamps V1.6.2 added; they hold only "she saw / opened
-- the banner" and every item row they sit on is kept. Run AFTER the code that reads them is rolled back.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

-- destructive: reviewed — the columns V1.6.2 added.
ALTER TABLE assessment_requests DROP COLUMN IF EXISTS notice_seen_at;
-- destructive: reviewed — the columns V1.6.2 added.
ALTER TABLE assessment_requests DROP COLUMN IF EXISTS notice_opened_at;
-- destructive: reviewed — the columns V1.6.2 added.
ALTER TABLE niete_lp612_deliveries DROP COLUMN IF EXISTS notice_seen_at;
-- destructive: reviewed — the columns V1.6.2 added.
ALTER TABLE niete_lp612_deliveries DROP COLUMN IF EXISTS notice_opened_at;

NOTIFY pgrst, 'reload schema';
