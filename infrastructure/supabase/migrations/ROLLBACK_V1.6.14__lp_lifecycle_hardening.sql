-- ROLLBACK V1.6.14 — back to V1.6.4's state: the three indexes and the error_code CHECK dropped, V1.6.4's own
-- comments restored word for word, and this migration's ledger row removed so the runner can apply it again.
-- Idempotent (IF EXISTS throughout). Needs V1.6.4's columns, as the forward file does.

DROP INDEX IF EXISTS idx_lp_requests_created;
DROP INDEX IF EXISTS idx_niete_lp_downloads_request_id;
DROP INDEX IF EXISTS idx_niete_lp612_deliveries_request_id;

ALTER TABLE lesson_plan_requests DROP CONSTRAINT IF EXISTS lesson_plan_requests_error_code_check;

COMMENT ON COLUMN lesson_plan_requests.delivered_at IS
  'Internal. When the send was accepted (WhatsApp) or the plan was served (portal). Set together with status = completed.';
COMMENT ON COLUMN lesson_plan_requests.error_code IS
  'Internal. Short machine code for a failed ask (e.g. GENERATION_FAILED, DELIVERY_FAILED, NO_ASSET); error_message keeps the detail.';
COMMENT ON COLUMN lesson_plan_requests.artifact_ref IS
  'Internal. The id of what was delivered, in the path''s own catalogue: a curriculum_lp_ast source_lp_uuid (niete_grounded), a niete_lp_assets lesson id (niete_v8_segment), a niete_lp612_segments segment_id (niete_lp612), a pic_lp_sessions id (pic_to_lp_kieai).';
COMMENT ON COLUMN niete_lp612_deliveries.request_id IS
  'Internal. The lesson_plan_requests row of the ask this grade 6-12 delivery answered. NULL before the lifecycle writer was switched on for niete_lp612, and on portal/backfill rows.';

DELETE FROM schema_versions WHERE version = '1.6.14';
