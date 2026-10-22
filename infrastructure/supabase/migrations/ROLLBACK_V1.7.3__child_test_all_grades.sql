-- ROLLBACK V1.7.3 — child_test: back to Grade 3 / Grade 5 and the day key without a grade.
-- Fails while a Grade 1, 2 or 4 row, or a :g<N> visit key, exists: remove those rows first (they are test rows
-- while sa_all_grades is a sandbox switch).
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE child_test_draws DROP CONSTRAINT IF EXISTS child_test_draws_grade_check;
ALTER TABLE child_test_draws ADD CONSTRAINT child_test_draws_grade_check CHECK (grade IN (3, 5));

ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_grade_check;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_grade_check CHECK (grade IN (3, 5));

ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_visit_key_format;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_visit_key_format CHECK (visit_key IS NULL OR visit_key ~
  '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}|sa:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$');
ALTER TABLE child_test_draws DROP CONSTRAINT IF EXISTS child_test_draws_visit_key_format;
ALTER TABLE child_test_draws ADD CONSTRAINT child_test_draws_visit_key_format CHECK (visit_key IS NULL OR visit_key ~
  '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}|sa:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$');
