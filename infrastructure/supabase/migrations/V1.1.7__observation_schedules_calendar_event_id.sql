-- V1.1.7 — observation_schedules.calendar_event_id.
--
-- WHY A COLUMN AND NOT A LOOKUP
-- -----------------------------
-- A scheduled observation can be moved or cancelled, and both operations have to
-- address the SAME calendar event that the original scheduling created. Google's
-- event id is the only stable handle for that; searching the calendar by title
-- and date to find "the event this probably was" is the same class of mistake as
-- resolving a coach by name — it works until two visits look alike.
--
-- Nullable, deliberately. Every row that existed before this feature has no
-- event, the feature is flag-gated off, and a calendar failure must never fail
-- the scheduling itself: a row with a NULL here is a schedule that simply has no
-- invite, which is a normal state, not an error.
--
-- SAFETY
-- ------
-- Additive, nullable, no default, no backfill. Nothing reads it until
-- OBSERVE_CALENDAR_ENABLED is set.

BEGIN;

ALTER TABLE observation_schedules
  ADD COLUMN IF NOT EXISTS calendar_event_id text;

COMMIT;
