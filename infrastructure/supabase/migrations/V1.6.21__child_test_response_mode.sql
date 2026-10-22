-- V1.6.21 — child_test: how the child answered each subtask (child_test_blocks.response_mode).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. A self-administered subtask is answered by tapping one of a few choices, typing on a keypad or
-- keyboard, reading aloud into a recording, or answering aloud. A tap or keypad score is its own scale
-- (it is not the recorded test's correct-per-minute), so every row says which way it was answered; NULL
-- is the coach-recorded test. The sink wrote the mode into responses[0] until this column existed; those
-- rows are backfilled from it.
--
-- DATA. Backfill only where response_mode is NULL and responses[0].mode is one of the five. LOAD. One
-- small UPDATE (self-administered rows only). SECURITY. Unchanged: RLS on, no policies. IDEMPOTENT.
-- Rollback: ROLLBACK_V1.6.21__child_test_response_mode.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE child_test_blocks ADD COLUMN IF NOT EXISTS response_mode text;

ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_response_mode_check;
ALTER TABLE child_test_blocks ADD CONSTRAINT child_test_blocks_response_mode_check
  CHECK (response_mode IS NULL OR response_mode IN ('tap', 'keypad', 'keyboard', 'record', 'oral'));

UPDATE child_test_blocks SET response_mode = responses -> 0 ->> 'mode'
WHERE response_mode IS NULL
  AND responses IS NOT NULL
  AND responses -> 0 ->> 'mode' IN ('tap', 'keypad', 'keyboard', 'record', 'oral');

COMMENT ON COLUMN child_test_blocks.response_mode IS
  'Internal. How the child answered: tap | keypad | keyboard | record | oral. NULL = the coach-recorded test. A tap/keypad score is the SA scale.';
