-- V1.7.3 — child_test: every grade (1–5) on the Learning assessment list, one list per grade per day.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. With the switch sa_all_grades the coach names Grade 1–5 for a school; the draw writes that grade on
-- child_test_draws and the session it opens, and names the visit day:<coach>:<school>:<date>:g<N> (one list per
-- coach per school per grade per day). The grade checks allowed 3 and 5 only, and the visit-key checks had no
-- grade suffix. A key without the suffix is unchanged.
--
-- DATA. None: constraints widened only, every existing row still passes. LOAD. Constraint swaps on two tables.
-- SECURITY. Unchanged: RLS on, no policies. IDEMPOTENT.
-- Rollback: ROLLBACK_V1.7.3__child_test_all_grades.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE child_test_draws DROP CONSTRAINT IF EXISTS child_test_draws_grade_check;
ALTER TABLE child_test_draws ADD CONSTRAINT child_test_draws_grade_check CHECK (grade BETWEEN 1 AND 5);

ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_grade_check;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_grade_check CHECK (grade BETWEEN 1 AND 5);

ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_visit_key_format;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_visit_key_format CHECK (visit_key IS NULL OR visit_key ~
  '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}(:g[1-5])?|sa:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$');
ALTER TABLE child_test_draws DROP CONSTRAINT IF EXISTS child_test_draws_visit_key_format;
ALTER TABLE child_test_draws ADD CONSTRAINT child_test_draws_visit_key_format CHECK (visit_key IS NULL OR visit_key ~
  '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}(:g[1-5])?|sa:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$');
