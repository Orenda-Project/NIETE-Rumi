-- V1.7.6 — assessment_requests.origin: which door a paper request came through (bd-pw1ccr.1).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. The EG A/B test counts how many of a report school's papers came from the Class Quiz Traffic Light report's
-- "Make topic paper" button. A request today records only its surface (whatsapp/portal/api), and surface cannot
-- carry this: deliveryFor() routes on it. cta_clicks records clicks, not papers. So one nullable column.
--
-- DATA. No rows change: every existing request is NULL (any other door). LOAD. Metadata-only ADD COLUMN.
-- SECURITY. Unchanged. IDEMPOTENT. ADD COLUMN IF NOT EXISTS.
-- Rollback: ROLLBACK_V1.7.6__assessment_request_origin.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE assessment_requests ADD COLUMN IF NOT EXISTS origin TEXT CHECK (origin IN ('report'));

NOTIFY pgrst, 'reload schema';
