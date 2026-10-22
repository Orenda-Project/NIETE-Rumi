-- ROLLBACK V1.6.1 — child_test: back to the three v1/v2 block names (bd-s1oo0.50.5).
--
-- Refuses while any v3 task row exists: narrowing the CHECK would fail on them anyway, and the AI
-- marks on those rows are write-once evidence that must not be deleted by a rollback. Move or
-- export them first, by hand, on purpose.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM child_test_blocks WHERE block NOT IN ('urdu', 'english', 'maths')) THEN
    RAISE EXCEPTION 'ROLLBACK_V1.6.1: child_test_blocks holds v3 task rows; export them before narrowing the block CHECK'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_block_check;
ALTER TABLE child_test_blocks ADD CONSTRAINT child_test_blocks_block_check
  CHECK (block IN ('urdu', 'english', 'maths'));
