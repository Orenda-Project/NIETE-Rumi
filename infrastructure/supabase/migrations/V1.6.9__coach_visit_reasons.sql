-- V1.6.9 — coach_visit_requests: her reasons and voice note, and a 'visited' status (bd-v0toag.38.9).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. The "Do you agree with this report?" ping replaces the one-tap ping (bd-v0toag.45) for groups C
-- and D. A teacher who does not agree ticks why (score | missed | wont_work | unclear) and may record a
-- voice note of up to 20 s. reasons holds the codes she ticked; voice_note_key the R2 key of her note
-- (coach-visit-notes/<request id>.<ext>), nulled once the coach marks the visit done and the note is
-- deleted. 'visited' = the coach tapped "I have visited" on the coach card.
--
-- WHY NO NEW TABLE. The request row already exists, one per report; the reasons and the note belong to it.
--
-- DATA. Reason codes and a storage key. No names, no phone, no message text.
-- IDEMPOTENT. IF NOT EXISTS; the status check is dropped and re-added under the same name.
-- Rollback: ROLLBACK_V1.6.9__coach_visit_reasons.sql
-- ORDER. Before the code: the new code writes reasons and voice_note_key. The table is empty on prod
-- (15 Oct 2026) and nothing writes to it while ab_v10_enabled is off.

ALTER TABLE coach_visit_requests ADD COLUMN IF NOT EXISTS reasons TEXT[];
ALTER TABLE coach_visit_requests ADD COLUMN IF NOT EXISTS voice_note_key TEXT;

ALTER TABLE coach_visit_requests DROP CONSTRAINT IF EXISTS coach_visit_requests_status_check;
ALTER TABLE coach_visit_requests ADD CONSTRAINT coach_visit_requests_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'no_coach', 'visited'));

COMMENT ON COLUMN coach_visit_requests.reasons IS
  'bd-v0toag.38.9: the reason codes she ticked (score, missed, wont_work, unclear). Empty = voice note only.';
COMMENT ON COLUMN coach_visit_requests.voice_note_key IS
  'bd-v0toag.38.9: R2 key of her voice note (up to 20 s); nulled when the coach marks the visit done and the note is deleted.';

NOTIFY pgrst, 'reload schema';
