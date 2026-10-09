-- ROLLBACK V1.6.3 — teacher app v2 "ready" fallback column and indexes (reverses migration V1.6.3).
-- destructive: reviewed — drops the two partial indexes and the one nullable timestamp V1.6.3 added; it holds only
-- "this item was messaged" and every item row it sits on is kept. Run AFTER the sweep is switched off (it already is by
-- default) and its code is rolled back. Rolling it back means an item could be messaged again if the sweep returns.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

DROP INDEX IF EXISTS idx_assessment_requests_notice_waiting;
DROP INDEX IF EXISTS idx_lp612_deliveries_notice_waiting;
-- destructive: reviewed — the column V1.6.3 added.
ALTER TABLE assessment_requests DROP COLUMN IF EXISTS notice_whatsapp_at;
-- destructive: reviewed — the column V1.6.3 added.
ALTER TABLE niete_lp612_deliveries DROP COLUMN IF EXISTS notice_whatsapp_at;

NOTIFY pgrst, 'reload schema';
