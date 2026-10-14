-- Rollback migration for V1.6.4. Removes the lifecycle columns, their CHECKs, the request links on
-- lesson_plans and the two delivery ledgers, and the two indexes.
-- destructive: reviewed — the columns hold only lifecycle bookkeeping (path, stage times, error code,
-- correlation id, the plan's request link); nothing a teacher sees is read from them.
-- SAFE ONLY after LP_LIFECYCLE_PATHS is unset on every service (bot, sqs-worker, sqs-worker-video,
-- portal) and those services have restarted, or the code is rolled back: with the key set, the
-- lifecycle writer writes these columns. A missing column is not an outage — every write that carries
-- them falls back to its pre-lifecycle form and the refusal is logged at error level — but it is noise
-- on every lesson plan. Unset the key FIRST.
DROP INDEX IF EXISTS idx_lp_requests_source_created;
DROP INDEX IF EXISTS idx_lesson_plans_request_id;

ALTER TABLE lesson_plans         DROP CONSTRAINT IF EXISTS lesson_plans_request_id_fkey;
ALTER TABLE niete_lp612_deliveries DROP CONSTRAINT IF EXISTS niete_lp612_deliveries_request_id_fkey;
ALTER TABLE niete_lp_downloads     DROP CONSTRAINT IF EXISTS niete_lp_downloads_request_id_fkey;
ALTER TABLE lesson_plan_requests DROP CONSTRAINT IF EXISTS lesson_plan_requests_channel_check;
ALTER TABLE lesson_plan_requests DROP CONSTRAINT IF EXISTS lesson_plan_requests_source_check;
ALTER TABLE lesson_plan_requests DROP CONSTRAINT IF EXISTS lesson_plan_requests_status_check;

-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE niete_lp612_deliveries DROP COLUMN IF EXISTS request_id;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE niete_lp_downloads     DROP COLUMN IF EXISTS request_id;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plans         DROP COLUMN IF EXISTS request_id;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS correlation_id;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS error_code;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS delivered_at;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS generated_at;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS artifact_ref;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS subject;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS grade;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS region;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS channel;
-- destructive: reviewed (rollback of V1.6.4)
ALTER TABLE lesson_plan_requests DROP COLUMN IF EXISTS source;

NOTIFY pgrst, 'reload schema';
