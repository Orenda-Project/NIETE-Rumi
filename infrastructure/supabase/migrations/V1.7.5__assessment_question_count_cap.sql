-- V1.7.5 — assessment_requests: raise the question_count cap from 60 to 100 so FDE pattern papers fit.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. V1.2.6 capped question_count at 60, sized for teacher-typed papers (the app caps those at 50). A pattern
-- paper stores the sum of its slots, and FDE Grade 1 English asks for 72, so its insert was refused and the portal
-- said only "Assessment lookup failed" (bd-5jmnfj.4.7). 100 leaves room for the largest pattern and still stops a
-- runaway count. tests/assessment/pattern-question-cap.test.js holds every pattern to this cap.
--
-- DATA. No rows change: every stored count is already 1–60. LOAD. One constraint check over assessment_requests.
-- SECURITY. Unchanged. IDEMPOTENT. The check is dropped by name and re-added.
-- Rollback: ROLLBACK_V1.7.5__assessment_question_count_cap.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE assessment_requests DROP CONSTRAINT IF EXISTS assessment_requests_question_count_check;
ALTER TABLE assessment_requests ADD CONSTRAINT assessment_requests_question_count_check
  CHECK (question_count BETWEEN 1 AND 100);
