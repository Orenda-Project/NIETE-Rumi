-- ROLLBACK V1.5.6 — assessment paper versions (reverses migration V1.5.6).
-- destructive: reviewed — drops only what V1.5.6 added (edited_from, its check and two indexes,
-- the transitional flag row); version rows are kept, renumbered as extra attempts.
--
-- Applies only BEFORE V1.5.7 (which drops the old edit columns). Nothing is deleted
-- from assessment_papers.
--
-- Versions become extra attempts (1001, 1002, …) so the old uniqueness holds again.
-- Old code then reads them as retries: requestStatus picks the highest attempt (a
-- version — harmless), listPapers shows each version as its own row.
-- Backfilled v1 rows (ids in the backfill manifest) may be deleted afterwards
-- with the manifest if duplicate portal rows are unacceptable.
BEGIN;
WITH v AS (
  SELECT id, 1000 + ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY created_at, id) AS a
    FROM assessment_papers WHERE edited_from IS NOT NULL)
UPDATE assessment_papers p SET attempt = v.a FROM v WHERE p.id = v.id;
DROP INDEX IF EXISTS uq_assessment_papers_request_attempt_generated;
ALTER TABLE assessment_papers ADD CONSTRAINT assessment_papers_request_id_attempt_key UNIQUE (request_id, attempt);
DROP INDEX IF EXISTS idx_assessment_papers_edited_from;
ALTER TABLE assessment_papers DROP CONSTRAINT IF EXISTS assessment_papers_edited_from_not_self;
-- destructive: reviewed — the column V1.5.6 added; versions stay as rows (renumbered above).
ALTER TABLE assessment_papers DROP COLUMN IF EXISTS edited_from;
DELETE FROM app_settings WHERE key = 'assessment_versions_enabled';
COMMIT;
NOTIFY pgrst, 'reload schema';
