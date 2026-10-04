-- V1.6.1 — child_test: battery v3 stores one child_test_blocks row per task (bd-s1oo0.50.5,
-- CONTRACT v0.16 §21.2). Versioned migration. Applied per environment, in order, from
-- infrastructure/supabase/migrations.
--
-- WHY. Battery v3 is the full EGRA/EGMA battery: 18 tasks per child, one voice note each
-- (ur.listening … ma.word_problems). Each task's recording, AI marks and coach check live in the
-- same columns a v1/v2 block uses, so a task IS a block row: block = task id. V1.5.9 pinned
-- block to ('urdu', 'english', 'maths'); this widens that CHECK to the v1/v2 three PLUS the 18
-- task ids, exactly tasks.BLOCK_NAMES (bot/shared/services/child-test/tasks.js; store.js reads the
-- same list). Rule 15: no new table, no new column. The unique key (session_id, block), the
-- write-once trigger on ai_marks and the once-only coach check apply to task rows unchanged.
--
-- WHAT. V1.5.9 declared the CHECK inline and unnamed, so Postgres named it
-- child_test_blocks_block_check. It is dropped by that name, and any other CHECK on the table
-- whose definition pins the block column to a list (a hand-built database) is dropped too; then
-- the named CHECK is added with the full list.
--
-- DATA. None changed. Every existing row ('urdu' / 'english' / 'maths') satisfies the new CHECK.
-- LOAD. One CHECK validation scan of child_test_blocks (one row per block tested; small).
-- SECURITY. Unchanged: RLS on, no policies, service role only.
-- IDEMPOTENT. Drop-then-add; running it twice leaves the same one constraint.
-- Rollback: ROLLBACK_V1.6.1__child_test_tasks.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_block_check;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'child_test_blocks'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '\(block = ANY'
  LOOP
    EXECUTE format('ALTER TABLE child_test_blocks DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$$;

ALTER TABLE child_test_blocks ADD CONSTRAINT child_test_blocks_block_check
  CHECK (block IN ('urdu', 'english', 'maths', 'ur.listening', 'ur.letters', 'ur.nonwords', 'ur.words', 'ur.story', 'en.listening', 'en.letters', 'en.nonwords', 'en.words', 'en.story', 'ma.number_id', 'ma.discrimination', 'ma.missing', 'ma.add1', 'ma.sub1', 'ma.add2', 'ma.sub2', 'ma.word_problems'));
