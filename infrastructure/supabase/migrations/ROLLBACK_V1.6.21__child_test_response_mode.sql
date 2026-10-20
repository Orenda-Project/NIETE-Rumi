-- ROLLBACK V1.6.21 — child_test: drop child_test_blocks.response_mode. The mode stays in responses[0].
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_response_mode_check;
ALTER TABLE child_test_blocks DROP COLUMN IF EXISTS response_mode;
