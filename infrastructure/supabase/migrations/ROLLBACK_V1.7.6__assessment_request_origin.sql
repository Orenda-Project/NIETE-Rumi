-- ROLLBACK V1.7.6 — assessment_requests: drop origin. The A/B test loses which papers came from the report button.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE assessment_requests DROP COLUMN IF EXISTS origin;

NOTIFY pgrst, 'reload schema';
