-- V1.6.14 — lesson-plan lifecycle hardening: the indexes the lifecycle's reads need at production volume, a
-- CHECK on error_code, and column comments that say what the code actually writes. Needs V1.6.4 (the lifecycle
-- columns and the ledger links) and refuses without it, changing nothing.
--
-- WHY, item by item (from the review of the lifecycle):
--   1. lesson_plan_requests (created_at DESC) WHERE source IS NOT NULL. The hourly health check reads lifecycle rows
--      by time alone — the last hour, and the last day for its down rule. The one lifecycle index leads on source
--      (idx_lp_requests_source_created); the sandbox planner picks it only because the table is small, and at
--      production volume it means walking every path's index entries for one time range.
--   2. niete_lp_downloads (request_id) and niete_lp612_deliveries (request_id), WHERE request_id IS NOT NULL. V1.6.4
--      linked both ledgers to their ask with ON DELETE SET NULL and left the links unindexed: deleting a request (an
--      account deletion) scans both ledgers once per deleted row. lesson_plans.request_id has had its index since V1.6.4.
--   3. The error_code CHECK: exactly the six codes the writer writes (LIFECYCLE.ERROR_CODES in
--      bot/shared/services/lesson-plan-lifecycle.service.js); tests/lesson-plan-lifecycle/vocabulary.test.js pins the
--      code, this file and the reference schema to one list. NOT VALID first, so new writes are held to it at once;
--      VALIDATE only when every existing row already complies, otherwise left NOT VALID and said so.
--   4. Comments: delivered_at (delivered is delivered_at, never the status), error_code (which codes are failures and
--      which are answers), artifact_ref (its format on every path), niete_lp612_deliveries.request_id (portal claims
--      carry it too). Checked against the code that writes each one.
--
-- DATA. No new column and no new data. Old code is unaffected: it writes no error_code, and NULL passes the CHECK.
--
-- LOCKS. One call from the migration runner is one transaction (no BEGIN/COMMIT here). CREATE INDEX (not
-- CONCURRENTLY, which cannot run inside it) holds SHARE on each table while it builds; ADD CONSTRAINT ... NOT VALID
-- takes ACCESS EXCLUSIVE for a moment and VALIDATE takes SHARE UPDATE EXCLUSIVE while it scans. At production sizes
-- (~110k niete_lp_downloads, ~7k niete_lp612_deliveries, ~9k lesson_plan_requests rows) the file runs in about a
-- second. lock_timeout is 5s: behind a long transaction it fails fast and is re-run, rather than queueing every
-- lesson-plan write. Apply outside school hours.
--
-- IDEMPOTENT. Every statement is IF NOT EXISTS or guarded by a catalog check. Reverse:
-- ROLLBACK_V1.6.14__lp_lifecycle_hardening.sql.

DO $$ BEGIN
  -- Never wait behind a long transaction with a lock queued: fail fast and be re-run.
  PERFORM set_config('lock_timeout', '5s', true);
END $$;

DO $$ BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'lesson_plan_requests'
         AND column_name IN ('source', 'error_code', 'delivered_at', 'artifact_ref')) < 4
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'niete_lp_downloads' AND column_name = 'request_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'niete_lp612_deliveries' AND column_name = 'request_id') THEN
    RAISE EXCEPTION 'V1.6.14 needs V1.6.4 (the lesson-plan lifecycle columns and the ledger links): apply V1.6.4 first';
  END IF;
END $$;

-- ─── indexes ────────────────────────────────────────────────────────────────────────────────────
-- The health check's windows: lifecycle rows by time, newest first.
CREATE INDEX IF NOT EXISTS idx_lp_requests_created
  ON lesson_plan_requests (created_at DESC) WHERE source IS NOT NULL;
-- The ledgers' links to their ask, for ON DELETE SET NULL and for the trace join. Partial: older rows carry none.
CREATE INDEX IF NOT EXISTS idx_niete_lp_downloads_request_id
  ON niete_lp_downloads (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_niete_lp612_deliveries_request_id
  ON niete_lp612_deliveries (request_id) WHERE request_id IS NOT NULL;

-- ─── the error_code vocabulary ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_plan_requests_error_code_check') THEN
    ALTER TABLE lesson_plan_requests ADD CONSTRAINT lesson_plan_requests_error_code_check
      CHECK (error_code IS NULL OR error_code IN (
        'GENERATION_FAILED', 'RENDER_FAILED', 'DELIVERY_FAILED', 'QUEUE_FAILED', 'NO_ASSET', 'NOT_ELIGIBLE')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM lesson_plan_requests
                  WHERE error_code IS NOT NULL
                    AND error_code NOT IN ('GENERATION_FAILED', 'RENDER_FAILED', 'DELIVERY_FAILED', 'QUEUE_FAILED',
                                           'NO_ASSET', 'NOT_ELIGIBLE')) THEN
    ALTER TABLE lesson_plan_requests VALIDATE CONSTRAINT lesson_plan_requests_error_code_check;
  ELSE
    RAISE NOTICE 'the error_code CHECK left NOT VALID: existing rows carry other error codes';
  END IF;
END $$;

-- ─── what the columns hold, checked against the code that writes them ────────────────────────────
COMMENT ON COLUMN lesson_plan_requests.delivered_at IS
  'Internal. When she got it: WhatsApp accepted the send, or the portal served the plan. NULL on every ask that did not reach her, whatever its status: a plan WhatsApp refused stays completed for the queue, with error_code DELIVERY_FAILED. Delivered means delivered_at IS NOT NULL.';
COMMENT ON COLUMN lesson_plan_requests.error_code IS
  'Internal. Why the ask did not end in a delivery; one of six codes (the CHECK). GENERATION_FAILED, RENDER_FAILED, DELIVERY_FAILED and QUEUE_FAILED are failures; NO_ASSET (nothing to send for what she asked) and NOT_ELIGIBLE (held, or no version for her group) are answers, never failures. error_message keeps the detail.';
COMMENT ON COLUMN lesson_plan_requests.artifact_ref IS
  'Internal. The id of what she was given, in the path''s own catalogue: niete_grounded = curriculum_lp_ast.source_lp_uuid; pre_gen_chapter = pre_generated_lps.id; niete_v8_segment = a niete_lp_assets lesson id; niete_lp612 = niete_lp612_segments.segment_id; niete_oxbridge = lesson_plan_catalog.id; niete_portal_share = the shared plan''s lesson or segment id, else the share item id; homework_bundle = the selection itself (e.g. grade_3:maths:1,2;grade_3:english:4); pic_to_lp_kieai = a pic_lp_sessions id.';
COMMENT ON COLUMN niete_lp612_deliveries.request_id IS
  'Internal. The lesson_plan_requests row of the ask this grade 6-12 row answered: a WhatsApp delivery or a portal claim. NULL before the lifecycle writer was switched on for niete_lp612, and on backfill rows.';
