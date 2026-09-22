-- V1.5.0 — a vendor may run its unit quizzes as PURE FORMATIVE.
--
-- I-SAPS's Sept 2026 facilitators' guide removed the pass requirement on
-- end-of-unit quizzes: the teacher answers, is shown the correct answer, and
-- moves on. Those items are the 25% formative component of a LEVEL-wide
-- composite (formative 25 / MCQ 50 / CRQ 25), so gating each quiz individually
-- double-counts the same work and blocks her on an item the level rule would
-- have forgiven.
--
-- WHY NOT module_passing_pct = 0. The pass-bar lookup treats a non-positive
-- value as a broken row and falls back to 100 — the STRICTEST bar — so zero
-- would demand a perfect score on every unit quiz, the exact opposite of the
-- intent. That fallback is correct and stays; this is a separate, explicit
-- flag rather than a magic value in a column that already means something.
--
-- Default FALSE: every other vendor keeps its gate (Taleemabad 100, Beacon
-- House 70, Oxbridge 70), and a vendor row that predates this column is
-- unaffected.
ALTER TABLE training_vendors
  ADD COLUMN IF NOT EXISTS module_quiz_ungated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN training_vendors.module_quiz_ungated IS
  'TRUE = end-of-unit quizzes do not gate progress; the teacher answers, sees the correct answer and continues. Used where those items are a weighted component of a level-wide composite instead.';
