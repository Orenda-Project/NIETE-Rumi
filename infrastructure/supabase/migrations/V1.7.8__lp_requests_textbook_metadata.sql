-- V1.7.8 — lesson_plan_requests.textbook_metadata (jsonb): where a free-form request records its track.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. The typed-topic seam (text-message.handler handleLessonPlanRequest) queues a topic that is in neither
-- catalogue for the free-form engine, behind app_settings.freeform_lp (OFF by default). The request row keeps
-- source = 'gamma_standard' (already in the source CHECK) and records the track in textbook_metadata.fflp_track;
-- the generation worker dispatches on that key of the ROW, never on the SQS payload alone. The main bot's
-- request table already has this jsonb; this deployment's does not, and no existing column can hold it:
-- source is a CHECK-bound path vocabulary the track must not live in, artifact_ref names a grounded
-- curriculum row, channel and error_code are CHECK-bound. The engine's other per-request keys
-- (e.g. fflp_context) ride in the same column.
-- Replaces V1.7.7 (a source CHECK swap for a 'freeform_v1' source), removed: nothing writes that source any
-- more. A database that applied it keeps one unused value in its source CHECK (harmless). The number 1.7.7 is
-- not reused, so a database whose ledger records the old 1.7.7 cannot skip this file.
--
-- DATA. No rows change: every existing request is NULL. LOAD. Metadata-only ADD COLUMN (nullable, no default).
-- lock_timeout 5s: behind a long transaction it fails fast and is re-run. SECURITY. Unchanged (RLS is per table).
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS. Rollback: ROLLBACK_V1.7.8__lp_requests_textbook_metadata.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

DO $$ BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
END $$;

ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS textbook_metadata jsonb;

COMMENT ON COLUMN lesson_plan_requests.textbook_metadata IS
  'Per-request free-form engine data. fflp_track (freeform_v1) marks a free-form request; the generation worker dispatches on it. NULL for every other request.';

NOTIFY pgrst, 'reload schema';
