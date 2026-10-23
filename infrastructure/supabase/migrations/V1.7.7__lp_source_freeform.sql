-- V1.7.7 — lesson_plan_requests.source accepts 'freeform_v1', the free-form lesson-plan engine's track.
--
-- WHY. The typed-topic seam (text-message.handler handleLessonPlanRequest) queues a topic that is in neither
-- catalogue for the free-form engine, behind app_settings.freeform_lp (OFF by default). Its request row carries
-- source = 'freeform_v1' (LIFECYCLE.SOURCES.FREEFORM_V1). V1.6.4's CHECK does not list that value, so the insert
-- would be refused; the seam then falls back to today's catalogue answer, so nothing breaks, but the engine could
-- never be reached. tests/lesson-plan-lifecycle/vocabulary.test.js pins the code, this file and the reference
-- schema to one list.
--
-- DATA. No row changes. The new list is the old one plus one value, so every existing row still passes and the
-- re-added constraint VALIDATEs. LOCKS. DROP + ADD ... NOT VALID take ACCESS EXCLUSIVE for a moment; VALIDATE takes
-- SHARE UPDATE EXCLUSIVE while it scans (~9k rows, well under a second). lock_timeout 5s: behind a long
-- transaction it fails fast and is re-run. One call from the migration runner is one transaction.
--
-- IDEMPOTENT. Drop-if-exists then add. Needs V1.6.4 (the source column). Reverse: ROLLBACK_V1.7.7__lp_source_freeform.sql.

DO $$ BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'lesson_plan_requests' AND column_name = 'source') THEN
    RAISE EXCEPTION 'V1.7.7 needs V1.6.4 (lesson_plan_requests.source): apply V1.6.4 first';
  END IF;
END $$;

ALTER TABLE lesson_plan_requests DROP CONSTRAINT IF EXISTS lesson_plan_requests_source_check;
ALTER TABLE lesson_plan_requests ADD CONSTRAINT lesson_plan_requests_source_check
  CHECK (source IS NULL OR source IN (
    'gamma_standard', 'gamma_enriched', 'ug_lp', 'ps_pregen', 'v7_segment', 'v7_chapter',
    'gamma_chapter', 'pre_gen_chapter', 'homework_bundle', 'pic_to_lp_kieai', 'kenya_browse',
    'multigrade_lp', 'niete_grounded', 'niete_v8_segment', 'niete_lp612', 'niete_oxbridge',
    'niete_portal_share', 'freeform_v1')) NOT VALID;
ALTER TABLE lesson_plan_requests VALIDATE CONSTRAINT lesson_plan_requests_source_check;

NOTIFY pgrst, 'reload schema';
