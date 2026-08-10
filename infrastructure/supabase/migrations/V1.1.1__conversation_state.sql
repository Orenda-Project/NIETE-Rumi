-- V1.1.1 — One durable home for "what is this teacher doing right now?".
--
-- Replaces four stores that disagreed with each other:
--   write   conversations.current_state        -- a row of the append-only MESSAGE LOG
--   read    conversations.current_state        -- text path
--   read    conversations.conversation_state   -- voice path; column never existed (42703)
--   clear   chat_sessions.conversation_state   -- a different table, so the clear was a no-op
--
-- Measured on production before this migration (Axiom, 30 days, env=production):
-- the state was written 5,128 times and read 11,359 times, and every branch that
-- depended on a non-null state fired ZERO times. It was dead code end to end.
--
-- Rule-15 note — two alternatives considered and rejected, one accepted:
--
-- REJECTED  a new `conversation_state` table. It would be the 77th table, and it
--             buys nothing here: the natural key is user_id, and a users row already
--             exists for every teacher, so a dedicated table only adds a join, a FK,
--             an insert-vs-update race and orphan cleanup.
--
-- REJECTED  chat_sessions.conversation_state, which already exists and is already
--             (wrongly) written by the clear path. chat_sessions ROTATE after 30
--             minutes idle — that rotation is precisely one of the three ways state
--             was being lost, so reusing it would preserve the bug.
--
-- ACCEPTED  two columns on users, mirroring the registration_state /
--             registration_state_updated_at pair that already lives on this table.
--             users is one row per teacher and never rotates, so the state is
--             addressed by the teacher alone — which is the fix.
--
-- Churn: ~9k rows, a few thousand state transitions a day. The partial index is the
-- only index on these columns, so autovacuum keeps up comfortably at this size.

BEGIN;

-- The state itself: { flow, step, payload, stack, version, updated_at }.
-- JSONB rather than columns because `payload` is per-flow and `stack` is variadic;
-- the fields the SERVER needs to reason about (the deadline) are real columns.
ALTER TABLE users ADD COLUMN IF NOT EXISTS conversation_state JSONB;

-- The deadline is a first-class column, not a field inside the JSON, so the sweeper
-- can index it and the read path can compare it in SQL. Per-step, set by the caller:
-- a menu tap and a coaching reflection do not deserve the same window.
ALTER TABLE users ADD COLUMN IF NOT EXISTS conversation_state_expires_at TIMESTAMPTZ;

-- Partial: only teachers mid-flow are ever scanned. At ~100 live rows out of ~9k
-- this stays tiny, and it is what makes "offer the thread back" a cheap sweep
-- rather than a full-table scan.
CREATE INDEX IF NOT EXISTS idx_users_conversation_state_expiry
  ON users (conversation_state_expires_at)
  WHERE conversation_state IS NOT NULL;

COMMENT ON COLUMN users.conversation_state IS
  'Active conversational flow for this teacher: {flow, step, payload, stack, version, updated_at}. '
  'Owned exclusively by bot/shared/services/conversation-state.service.js. '
  'Keyed on the teacher, never on a chat session — chat_sessions rotate after 30 minutes idle.';

COMMENT ON COLUMN users.conversation_state_expires_at IS
  'Per-step deadline for conversation_state. Enforced ON READ (not only by the sweeper), '
  'so a sweeper that has not run yet can never serve stale state.';

COMMIT;
