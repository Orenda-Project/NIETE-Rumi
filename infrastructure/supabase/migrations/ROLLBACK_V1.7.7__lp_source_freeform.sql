-- ROLLBACK V1.7.7 — back to V1.6.4's source CHECK (without 'freeform_v1'). Refuses while any row carries
-- 'freeform_v1' (re-adding the old list would fail VALIDATE): switch app_settings.freeform_lp off and decide what
-- happens to those rows first. Idempotent. Removes this migration's ledger row so the runner can apply it again.
-- The CHECK swap takes an ACCESS EXCLUSIVE lock on lesson_plan_requests: wait at most 5s for it, as the forward file does.

DO $$ BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM lesson_plan_requests WHERE source = 'freeform_v1') THEN
    RAISE EXCEPTION 'ROLLBACK V1.7.7: lesson_plan_requests rows with source = freeform_v1 exist; handle them first';
  END IF;
END $$;

ALTER TABLE lesson_plan_requests DROP CONSTRAINT IF EXISTS lesson_plan_requests_source_check;
ALTER TABLE lesson_plan_requests ADD CONSTRAINT lesson_plan_requests_source_check
  CHECK (source IS NULL OR source IN (
    'gamma_standard', 'gamma_enriched', 'ug_lp', 'ps_pregen', 'v7_segment', 'v7_chapter',
    'gamma_chapter', 'pre_gen_chapter', 'homework_bundle', 'pic_to_lp_kieai', 'kenya_browse',
    'multigrade_lp', 'niete_grounded', 'niete_v8_segment', 'niete_lp612', 'niete_oxbridge',
    'niete_portal_share')) NOT VALID;
ALTER TABLE lesson_plan_requests VALIDATE CONSTRAINT lesson_plan_requests_source_check;

DELETE FROM schema_versions WHERE version = '1.7.7';

NOTIFY pgrst, 'reload schema';
