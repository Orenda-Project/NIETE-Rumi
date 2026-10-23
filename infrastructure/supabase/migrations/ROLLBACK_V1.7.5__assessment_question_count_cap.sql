-- ROLLBACK V1.7.5 — assessment_requests: put the question_count cap back to 60.
-- Fails while any row holds more than 60 questions (an FDE Grade 1 English paper does); delete or archive those
-- requests first, or leave the cap at 100.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE assessment_requests DROP CONSTRAINT IF EXISTS assessment_requests_question_count_check;
ALTER TABLE assessment_requests ADD CONSTRAINT assessment_requests_question_count_check
  CHECK (question_count BETWEEN 1 AND 60);
