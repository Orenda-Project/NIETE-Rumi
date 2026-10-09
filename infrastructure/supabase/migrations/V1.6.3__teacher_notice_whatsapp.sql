-- V1.6.3 — teacher app v2 "ready" fallback: one nullable timestamp on the same two per-teacher item rows, and the
-- two partial indexes the sweep reads through. No new table.
-- Versioned migration in infrastructure/supabase/migrations (applied per environment, in order). Follows V1.6.2.
--
-- WHY. When a finished paper or grades 6-12 lesson plan was neither seen (she closed the banner with its X) nor
-- opened, ONE WhatsApp message follows (a UTILITY template with the PDF and an "Open in app" button). It must be sent
-- at most once per item, decided on the server because the app may be closed. That needs a durable "already
-- messaged" fact per item, and an atomic way to claim it.
--
-- WHY NOT NEW STORAGE (checked against the live sandbox schema, 9 Oct 2026): the item rows already exist per teacher
-- (assessment_requests; her 'portal' rows in niete_lp612_deliveries) and V1.6.2 put seen/opened on them; "messaged" is
-- the third fact about the SAME item. A separate sends table would need its own key, its own FKs and a join on every
-- read, and could not give the one-statement claim below. teacher_nudges (V1.5.3) is a SCHEDULE of asks with its own
-- lifecycle, caps and kinds — it is the wrong shape for "was this item messaged".
--
-- THE CLAIM. UPDATE … SET notice_whatsapp_at = now() WHERE id = $1 AND notice_whatsapp_at IS NULL AND
-- notice_opened_at IS NULL AND notice_seen_at IS NULL RETURNING id — one statement, so two replicas sweeping in the
-- same second cannot both win, and a teacher who opens the item a moment before cannot be messaged.
--
--   notice_whatsapp_at   the instant the fallback claimed the item to message her. NULL = never. A claim is NOT
--                        retried even if Meta refused the send (a missed message beats a duplicate); the refusal is
--                        logged at error level.
--
-- THE INDEXES. The sweep asks, every 20 seconds, "which portal items are unseen, unopened and unmessaged?" across all
-- teachers — a query no existing index serves (the table indexes are per teacher). Each index is PARTIAL on exactly
-- that predicate, so it holds only the rows still waiting and an item drops out the moment it is seen, opened or
-- messaged. Load (Class R): ~hundreds of portal items a day; the index stays at tens of rows; one bounded read per
-- 20 s per sweeping worker, and the sweep reads nothing at all while the switch is off.
--
-- DATA. A timestamp only. Classification: internal. IDEMPOTENT: IF NOT EXISTS throughout. Rollback:
-- ROLLBACK_V1.6.3__teacher_notice_whatsapp.sql. ORDER: apply BEFORE the code that selects the column; additive and
-- nullable, and the sweep is OFF by default, so nothing reads it until the switch is turned on.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT. (CREATE INDEX without CONCURRENTLY: both
-- tables are small — thousands of rows — and the lock is momentary.)

ALTER TABLE assessment_requests
  ADD COLUMN IF NOT EXISTS notice_whatsapp_at timestamptz;

ALTER TABLE niete_lp612_deliveries
  ADD COLUMN IF NOT EXISTS notice_whatsapp_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_assessment_requests_notice_waiting
  ON assessment_requests (created_at)
  WHERE surface = 'portal' AND notice_seen_at IS NULL AND notice_opened_at IS NULL AND notice_whatsapp_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lp612_deliveries_notice_waiting
  ON niete_lp612_deliveries (delivered_at)
  WHERE surface = 'portal' AND notice_seen_at IS NULL AND notice_opened_at IS NULL AND notice_whatsapp_at IS NULL;

COMMENT ON COLUMN assessment_requests.notice_whatsapp_at IS
  'Internal. When the ready-notice fallback claimed this paper to message the teacher on WhatsApp (one conditional UPDATE; never retried). NULL = never messaged.';
COMMENT ON COLUMN niete_lp612_deliveries.notice_whatsapp_at IS
  'Internal. When the ready-notice fallback claimed this lesson plan to message the teacher on WhatsApp (one conditional UPDATE; never retried). Portal rows only. NULL = never messaged.';

NOTIFY pgrst, 'reload schema';
