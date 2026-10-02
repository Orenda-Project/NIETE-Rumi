-- Reverse of V1.6.0. Drops the visit key columns, their checks, indexes and triggers.
-- destructive: reviewed — visit_key holds only ids and a date. A list drawn under a key (no
-- observe2 visit) loses the name of its visit: its rows keep their ranks and outcomes, but that
-- visit's list can no longer be reopened.
-- SAFE ONLY after the code is rolled back: draw/index.js and store.js write visit_key. Roll the CODE
-- back first.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.
DROP TRIGGER IF EXISTS child_test_sessions_name_visit ON child_test_sessions;
DROP TRIGGER IF EXISTS child_test_draws_name_visit ON child_test_draws;
DROP FUNCTION IF EXISTS child_test_sessions_name_visit();
DROP FUNCTION IF EXISTS child_test_draws_name_visit();
DROP INDEX IF EXISTS idx_child_test_sessions_visit_key;
DROP INDEX IF EXISTS idx_child_test_draws_visit_key;
ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_one_visit;
ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_visit_key_format;
ALTER TABLE child_test_draws DROP CONSTRAINT IF EXISTS child_test_draws_one_visit;
ALTER TABLE child_test_draws DROP CONSTRAINT IF EXISTS child_test_draws_visit_key_format;
ALTER TABLE child_test_sessions DROP COLUMN IF EXISTS visit_key;
ALTER TABLE child_test_draws DROP COLUMN IF EXISTS visit_key;
NOTIFY pgrst, 'reload schema';
