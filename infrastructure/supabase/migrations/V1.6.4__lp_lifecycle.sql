-- V1.6.4 — lesson-plan lifecycle: every lesson-plan ask leaves one row in lesson_plan_requests that
-- says which path served it, when each stage happened, how it ended, and the correlation id of its
-- logs; and every plan row, and every row of the two delivery ledgers the portal lists, names its ask.
-- Versioned migration in infrastructure/supabase/migrations (applied per environment, in order). Follows V1.6.3.
--
-- WHY. A data analyst cannot trace a lesson plan seen in the portal back to its ask, its outcome or
-- its logs. On production (BigQuery mirror, 13 Oct 2026): 109,103 lesson_plans rows since July, of
-- which 7,963 came from the only path that writes a request row (Gamma); grade 1-5 v8 deliveries,
-- grade 6-12 deliveries, pic-to-LP and homework leave no request row, so they have no status, no
-- failure record and no stage times; no row anywhere carries the correlation id that joins it to the
-- logs; lesson_plans has no column naming its request (the analyst joins on gamma_url, which most
-- rows do not have).
--
-- WHY NOT A NEW TABLE (checked against the live sandbox schema, 13 Oct, not from memory).
-- lesson_plan_requests is already the record of an ask and its status, with a history trigger on
-- status (log_row_changes) and an index on (status, created_at) and on user_id. What it lacks is the
-- path, the stage times after "started", an error code and the correlation id. Ten nullable columns
-- on the table that already holds the fact beat a second table that would have to be joined to it
-- for every question. lesson_plans and the two delivery ledgers need only the link back.
--
-- ONE WRITER. bot/shared/services/lesson-plan-lifecycle.service.js is the only code that sets these
-- columns. The vocabularies below (source, channel, status) are exported from that module as
-- constants and a test asserts the lists are identical, so the code and the CHECKs cannot drift.
-- Writing is switched by the LP_LIFECYCLE_PATHS env key; unset, no code reads or writes any column
-- this file adds.
--
-- DATA. No new personal data: a path name, a channel, a region code, a grade, a subject, an artefact
-- reference (a catalogue/segment/session id), stage timestamps, a short error code, a correlation id.
-- phone_number and topic already exist on this table and are unchanged.
--
-- LOAD (Class R). Production delivers ~1,100 lesson plans per school day across all paths (BigQuery,
-- Sep-Oct 2026): ~1,100 inserts and ~2,000 single-row updates a day, each by primary key. Reads are by
-- id, by user_id (existing index) and by (source, created_at) (new index) for the health check.
--
-- LOCKS. One RPC call from the migration runner = one transaction (no BEGIN/COMMIT here), so every
-- lock taken below is held until it commits: ADD COLUMN and ADD CONSTRAINT take ACCESS EXCLUSIVE on
-- lesson_plan_requests, lesson_plans, niete_lp_downloads and niete_lp612_deliveries, and keep it
-- through the VALIDATE scans and the index build. At production sizes (~110k lesson_plans rows, ~9k
-- requests, small ledgers) the whole file runs in about a second. lock_timeout is set to 5s first:
-- if a long transaction is holding one of these tables, the migration fails fast and is re-run,
-- rather than queueing every lesson-plan write behind it. Apply outside school hours. migrate.js
-- does not print RAISE NOTICE; after applying, read pg_constraint.convalidated (the rollout says how).
--
-- IDEMPOTENT. Every statement is IF NOT EXISTS or guarded by a catalog check, so re-running the file
-- changes nothing. Reverse: ROLLBACK_V1.6.4__lp_lifecycle.sql.

DO $$ BEGIN
  -- Never wait behind a long transaction with ACCESS EXCLUSIVE queued: fail fast and be re-run.
  PERFORM set_config('lock_timeout', '5s', true);
END $$;

-- ─── lesson_plan_requests: the lifecycle columns ────────────────────────────────────────────────
ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS source         text;
ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS channel        text;
ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS region         text;
ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS grade          integer;
ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS subject        text;
ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS artifact_ref   text;
ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS generated_at   timestamptz;
ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS delivered_at   timestamptz;
ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS error_code     text;
ALTER TABLE lesson_plan_requests ADD COLUMN IF NOT EXISTS correlation_id text;

-- ─── the link back to the ask: the plan row, and the two delivery ledgers the portal lists ───────
-- The NIETE portal's Home, Lessons and Recent lists are built from niete_lp_downloads (grades 1-5)
-- and niete_lp612_deliveries (grades 6-12); naming the ask on those rows makes every item in those
-- lists traceable to its lifecycle row by key, never by a time-proximity guess.
ALTER TABLE lesson_plans           ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE niete_lp_downloads     ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE niete_lp612_deliveries ADD COLUMN IF NOT EXISTS request_id uuid;

-- ─── vocabularies, enforced in the database ─────────────────────────────────────────────────────
-- Added NOT VALID: enforced for every new write at once, without scanning old rows. Validated below
-- only if no old row would fail.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_plan_requests_status_check') THEN
    ALTER TABLE lesson_plan_requests ADD CONSTRAINT lesson_plan_requests_status_check
      CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_plan_requests_source_check') THEN
    ALTER TABLE lesson_plan_requests ADD CONSTRAINT lesson_plan_requests_source_check
      CHECK (source IS NULL OR source IN (
        'gamma_standard', 'gamma_enriched', 'ug_lp', 'ps_pregen', 'v7_segment', 'v7_chapter',
        'gamma_chapter', 'pre_gen_chapter', 'homework_bundle', 'pic_to_lp_kieai', 'kenya_browse',
        'multigrade_lp', 'niete_grounded', 'niete_v8_segment', 'niete_lp612', 'niete_oxbridge',
        'niete_portal_share')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_plan_requests_channel_check') THEN
    ALTER TABLE lesson_plan_requests ADD CONSTRAINT lesson_plan_requests_channel_check
      CHECK (channel IS NULL OR channel IN ('whatsapp', 'portal')) NOT VALID;
  END IF;
  -- A plan or ledger row names its ask. SET NULL, not CASCADE: what the teacher received outlives
  -- the bookkeeping row of how it was asked for.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_plans_request_id_fkey') THEN
    ALTER TABLE lesson_plans ADD CONSTRAINT lesson_plans_request_id_fkey
      FOREIGN KEY (request_id) REFERENCES lesson_plan_requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'niete_lp_downloads_request_id_fkey') THEN
    ALTER TABLE niete_lp_downloads ADD CONSTRAINT niete_lp_downloads_request_id_fkey
      FOREIGN KEY (request_id) REFERENCES lesson_plan_requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'niete_lp612_deliveries_request_id_fkey') THEN
    ALTER TABLE niete_lp612_deliveries ADD CONSTRAINT niete_lp612_deliveries_request_id_fkey
      FOREIGN KEY (request_id) REFERENCES lesson_plan_requests(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- Validate each constraint only when every existing row already satisfies it; otherwise leave it
-- NOT VALID (still enforced on every new write) and say so, rather than fail the whole migration.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM lesson_plan_requests
                  WHERE status IS NOT NULL
                    AND status NOT IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) THEN
    ALTER TABLE lesson_plan_requests VALIDATE CONSTRAINT lesson_plan_requests_status_check;
  ELSE
    RAISE NOTICE 'lesson_plan_requests_status_check left NOT VALID: existing rows carry other status values';
  END IF;
  ALTER TABLE lesson_plan_requests VALIDATE CONSTRAINT lesson_plan_requests_source_check;   -- new column: all NULL
  ALTER TABLE lesson_plan_requests VALIDATE CONSTRAINT lesson_plan_requests_channel_check;  -- new column: all NULL
  ALTER TABLE lesson_plans           VALIDATE CONSTRAINT lesson_plans_request_id_fkey;            -- new column: all NULL
  ALTER TABLE niete_lp_downloads     VALIDATE CONSTRAINT niete_lp_downloads_request_id_fkey;      -- new column: all NULL
  ALTER TABLE niete_lp612_deliveries VALIDATE CONSTRAINT niete_lp612_deliveries_request_id_fkey;  -- new column: all NULL
END $$;

-- ─── indexes ────────────────────────────────────────────────────────────────────────────────────
-- From a request to its plan (the trace join). Partial: rows written before this ships carry none.
CREATE INDEX IF NOT EXISTS idx_lesson_plans_request_id
  ON lesson_plans (request_id) WHERE request_id IS NOT NULL;
-- The health and integrity checks read one path's recent asks.
CREATE INDEX IF NOT EXISTS idx_lp_requests_source_created
  ON lesson_plan_requests (source, created_at DESC) WHERE source IS NOT NULL;

-- ─── what each column means (D6 classification first) ───────────────────────────────────────────
COMMENT ON COLUMN lesson_plan_requests.source IS
  'Internal. The path that served the ask (one value per path, listed in the CHECK). NULL on rows written before the lifecycle writer was switched on for that path.';
COMMENT ON COLUMN lesson_plan_requests.channel IS
  'Internal. Where the teacher asked and received it: whatsapp | portal.';
COMMENT ON COLUMN lesson_plan_requests.region IS
  'Internal. The deployment that served it (the REGION env of the bot, e.g. niete).';
COMMENT ON COLUMN lesson_plan_requests.grade IS
  'Internal. The grade the plan is for, 1-12, when the path knows it.';
COMMENT ON COLUMN lesson_plan_requests.subject IS
  'Internal. The subject the plan is for, when the path knows it.';
COMMENT ON COLUMN lesson_plan_requests.artifact_ref IS
  'Internal. The id of what was delivered, in the path''s own catalogue: a curriculum_lp_ast source_lp_uuid (niete_grounded), a niete_lp_assets lesson id (niete_v8_segment), a niete_lp612_segments segment_id (niete_lp612), a pic_lp_sessions id (pic_to_lp_kieai).';
COMMENT ON COLUMN lesson_plan_requests.generated_at IS
  'Internal. When the artefact was ready to send (generated, rendered, or found ready in a cache).';
COMMENT ON COLUMN lesson_plan_requests.delivered_at IS
  'Internal. When the send was accepted (WhatsApp) or the plan was served (portal). Set together with status = completed.';
COMMENT ON COLUMN lesson_plan_requests.error_code IS
  'Internal. Short machine code for a failed ask (e.g. GENERATION_FAILED, DELIVERY_FAILED, NO_ASSET); error_message keeps the detail.';
COMMENT ON COLUMN lesson_plan_requests.correlation_id IS
  'Internal. The correlationId of the request''s log lines in Axiom; joins this row to its logs.';
COMMENT ON COLUMN lesson_plans.request_id IS
  'Internal. The lesson_plan_requests row this plan was delivered for. NULL on rows written before the lifecycle writer was switched on for their path.';
COMMENT ON COLUMN niete_lp_downloads.request_id IS
  'Internal. The lesson_plan_requests row of the ask this grade 1-5 delivery attempt answered. NULL before the lifecycle writer was switched on for niete_v8_segment.';
COMMENT ON COLUMN niete_lp612_deliveries.request_id IS
  'Internal. The lesson_plan_requests row of the ask this grade 6-12 delivery answered. NULL before the lifecycle writer was switched on for niete_lp612, and on portal/backfill rows.';

NOTIFY pgrst, 'reload schema';
