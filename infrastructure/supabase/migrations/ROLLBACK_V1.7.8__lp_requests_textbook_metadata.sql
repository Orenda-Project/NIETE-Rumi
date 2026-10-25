-- ROLLBACK V1.7.8 — lesson_plan_requests: drop textbook_metadata. Refuses while any row holds data there (a
-- free-form request's track would be lost and the worker would drop its job): switch app_settings.freeform_lp
-- off and decide what happens to those rows first. Removes this migration's ledger row so the runner can apply
-- it again. One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

DO $$ BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM lesson_plan_requests WHERE textbook_metadata IS NOT NULL) THEN
    RAISE EXCEPTION 'ROLLBACK V1.7.8: lesson_plan_requests rows with textbook_metadata exist; handle them first';
  END IF;
END $$;

ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS textbook_metadata;

DELETE FROM schema_versions WHERE version = '1.7.8';

NOTIFY pgrst, 'reload schema';
