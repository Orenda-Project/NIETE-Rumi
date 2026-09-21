-- V1.2.5 — the CRQ marking rubric, stored next to the question it marks.
--
-- I-SAPS ships a DIFFERENT rubric for every constructed-response question: 36
-- of them in Level 1, each with three criteria and its own band descriptions.
-- The seeder stored only the question text, so `scoreAnswer()` graded with a
-- generic "score 0-5 for practical classroom writing" prompt that had never
-- seen a rubric. Measured against 46 hand-graded answers that marker sat at
-- 0.80 mean absolute error with 0.26 run-to-run drift; the same model handed
-- the real rubric reached 0.22 and 0.02.
--
-- It is also what the partner's own §4.3 requires: AI marking is permitted
-- only against the rubric and notes.
--
-- A COLUMN, NOT A TABLE. A rubric belongs to exactly one question and is read
-- on exactly the path that reads the question; a side table would buy a join
-- and an orphan class for nothing.
--
-- Shape (jsonb), verbatim from the partner .docx:
--   {"total_marks": 10,
--    "criteria": [ {"name": "...", "marks": 4,
--                   "bands": {"4": "...", "3": "...", "2": "...", "1": "..."}} ]}
-- A band absent from `bands` is unreachable for that criterion — the source
-- prints "-" for it. That is why the floor is 1 per criterion and no answer,
-- including an empty one, can score below 3 of 10. That is I-SAPS's design,
-- not ours; do not "fix" it in code.
ALTER TABLE training_questions
  ADD COLUMN IF NOT EXISTS rubric jsonb;

COMMENT ON COLUMN training_questions.rubric IS
  'Per-question CRQ marking rubric (criteria + band descriptions), verbatim from the partner source. NULL for MCQs.';

-- Only CRQs carry one, and they are a small slice of the table.
CREATE INDEX IF NOT EXISTS idx_training_questions_rubric
  ON training_questions (id) WHERE rubric IS NOT NULL;
