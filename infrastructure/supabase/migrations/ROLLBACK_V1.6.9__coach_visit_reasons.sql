-- ROLLBACK V1.6.9 — coach_visit_reasons (reverses migration V1.6.9).
-- destructive: reviewed — drops only the two columns V1.6.9 added and restores the V1.6.7 status check.
-- Delete any voice notes under coach-visit-notes/ in R2 first, or their keys are lost.
-- A row already marked 'visited' blocks the old check: set it back to 'sent' by hand before running.
BEGIN;
ALTER TABLE coach_visit_requests DROP CONSTRAINT IF EXISTS coach_visit_requests_status_check;
ALTER TABLE coach_visit_requests ADD CONSTRAINT coach_visit_requests_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'no_coach'));
ALTER TABLE coach_visit_requests DROP COLUMN IF EXISTS voice_note_key;
ALTER TABLE coach_visit_requests DROP COLUMN IF EXISTS reasons;
COMMIT;
