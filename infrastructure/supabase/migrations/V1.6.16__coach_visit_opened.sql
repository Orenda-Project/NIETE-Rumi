-- V1.6.16 — coach_visit_requests.opened_at: when the coach first opened the disagreement card (bd-tbprit.7).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. Rifat's prototype list shows a blue dot on every card the coach has not opened yet. opened_at is
-- stamped once, by GET /coach/disagreements/:id, the first time the request's own coach opens it; never
-- overwritten after (the write is guarded by opened_at IS NULL). NULL = not opened yet.
--
-- WHY NO NEW TABLE. One row per request already exists, and the coach who may open it is on that row.
-- Nothing else records a card being opened: no event log covers the coach portal's card route.
--
-- DATA. A timestamp. No names, no phone, no message text.
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS.
-- Rollback: ROLLBACK_V1.6.16__coach_visit_opened.sql
-- ORDER. Before the code: the new list reads opened_at, and a select of a missing column fails the list.

ALTER TABLE coach_visit_requests ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;

COMMENT ON COLUMN coach_visit_requests.opened_at IS
  'bd-tbprit.7: when the request''s coach first opened the disagreement card. NULL = not opened (the list''s blue dot).';

NOTIFY pgrst, 'reload schema';
