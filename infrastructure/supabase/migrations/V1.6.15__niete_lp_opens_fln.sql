-- V1.6.15 — niete_lp_opens admits plan_kind 'fln'; niete_fln_events (Reading Hour / FLN portal events).
-- Versioned migration in infrastructure/supabase/migrations (applied per environment, in order, by hand).
-- Depends on V1.6.1 only (niete_lp_opens) and applies on main's schema: it references nothing V1.6.14 creates.
-- Rollback: ROLLBACK_V1.6.15__niete_lp_opens_fln.sql
--
-- WHY. The portal now serves foundational-literacy-and-numeracy (FLN) lesson plans. Opening one
-- is an ordinary portal open, so it is recorded in niete_lp_opens like K-5 and 6-12 opens
-- (one definition of "opened", not a second ledger). That table's plan_kind CHECK admits only
-- 'k5' and 'g612', so an 'fln' open would be refused. The CHECK is widened to 'k5','g612','fln'.
-- plan_ref for 'fln' is the plan id (text, digits); lang is the plan's language; source 'viewer'.
--
-- WHY A NEW TABLE (Rule 15, last resort). The FLN page also emits client events that are not
-- opens: audio play and audio error with a latency in ms, share, link copy, open-link, and a
-- leader-to-teacher send (a coach, principal or AEO sends a plan to a teacher). They have no teacher-id grain (the key is already hashed), no plan
-- row to hang off, and they must not enter niete_lp_opens, whose readers count every row as a
-- lesson plan used. niete_fln_events is narrow, append-only and has one index.
--
-- WHAT A niete_fln_events ROW IS. user_key = the portal's keyed id of the actor (a keyed hash,
-- never a phone, name or raw users.id); kind = one of six events; plan_ref = the plan id when
-- the event concerns one; clip = the audio clip id for audio_* events; ms = latency/duration;
-- result = the outcome (ok / an error class); ua_class = a coarse user-agent class (never the
-- raw string).
-- A 'send' row is the one kind that involves two people: user_key is the SENDER's keyed id and
-- clip carries the RECIPIENT's keyed id (the column is otherwise unused for a send, and a
-- second key column would be one more place an identifier could live). Both are keyed ids, so
-- no phone number or name is ever stored, and result is the delivery outcome.
-- DATA. Keyed ids, a plan id, short enums, a number, a timestamp. Classification: internal.
-- LOAD (Class R). One insert per event, no reads on the hot path; the one reporting query is
-- bounded by niete_fln_events_created_idx (last-day window, p95 of ms per kind/result).
-- SECURITY. RLS on, no policies: service role only, like niete_lp_opens.
--
-- IDEMPOTENT (no migration ledger; re-running on staging or prod must be a no-op):
-- DROP CONSTRAINT IF EXISTS then ADD, CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- Every existing niete_lp_opens row is 'k5' or 'g612', so re-adding the widened CHECK validates.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE niete_lp_opens DROP CONSTRAINT IF EXISTS niete_lp_opens_plan_kind_check;
ALTER TABLE niete_lp_opens ADD CONSTRAINT niete_lp_opens_plan_kind_check
  CHECK (plan_kind IN ('k5', 'g612', 'fln'));

CREATE TABLE IF NOT EXISTS niete_fln_events (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  user_key    text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('audio_play', 'audio_error', 'share', 'link_copy', 'open_link', 'send')),
  plan_ref    text,
  clip        text,
  ms          integer,
  result      text,
  ua_class    text
);

CREATE INDEX IF NOT EXISTS niete_fln_events_created_idx
  ON niete_fln_events (created_at);

ALTER TABLE niete_fln_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE niete_fln_events IS
  'Internal. Append-only FLN portal events (audio play/error, share, link copy, open link, send). Keyed ids only — no phone, name or message text. Owner: Digital Coach team.';
COMMENT ON COLUMN niete_fln_events.user_key IS
  'Internal. Keyed id of the actor. For kind=send this is the SENDER''s keyed id.';
COMMENT ON COLUMN niete_fln_events.clip IS
  'Internal. Audio clip id for audio_* events; for kind=send the RECIPIENT''s keyed id.';

NOTIFY pgrst, 'reload schema';
