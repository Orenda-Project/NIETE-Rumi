-- Reverse of V1.5.9. Three new tables, so the reverse removes them — and with them every child
-- test draw, session and mark.
-- destructive: reviewed — the tables hold only the child test (ICT EGRA/EGMA); nothing outside
-- bot/shared/services/child-test reads them.
-- SAFE ONLY after the code is rolled back or CHILD_TEST_ENABLED is unset: /egra and the scorers
-- write them. Roll the CODE back first. Export the rows first if any real child was tested.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.
DROP TRIGGER IF EXISTS child_test_blocks_keep_marks ON child_test_blocks;
DROP TRIGGER IF EXISTS child_test_draws_keep_rank ON child_test_draws;
DROP TRIGGER IF EXISTS update_child_test_blocks_updated_at ON child_test_blocks;
DROP TRIGGER IF EXISTS update_child_test_sessions_updated_at ON child_test_sessions;
DROP TRIGGER IF EXISTS update_child_test_draws_updated_at ON child_test_draws;
DROP FUNCTION IF EXISTS child_test_blocks_keep_marks();
DROP FUNCTION IF EXISTS child_test_draws_keep_rank();
DROP TABLE IF EXISTS child_test_blocks;
DROP TABLE IF EXISTS child_test_sessions;
DROP TABLE IF EXISTS child_test_draws;
NOTIFY pgrst, 'reload schema';
