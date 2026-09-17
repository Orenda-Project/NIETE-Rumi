-- bd-60119 — allow more than one summative quiz per level, keyed by module.
--
-- I-SAPS assesses at the END OF EACH MODULE (assessment doc §4), and the source
-- workbooks are organised that way: 9 modules, each with its own scenario MCQs
-- and its own CRQ. The first import put all 63 MCQs in one level-wide grand
-- quiz and all 36 CRQs in one level-wide capstone, because
-- UNIQUE (level_id, quiz_type) allows exactly one of each per level.
--
-- The key is widened to include source_quiz_id, which carries the module number
-- (900 + module). Verified before writing: zero duplicates under the wider key,
-- and every existing level currently holds AT MOST ONE quiz per type — so no
-- vendor's data changes and no backfill is needed.
--
-- WHAT THIS GIVES UP, stated plainly: the database no longer guarantees one
-- exam per level. teacher-training-endpoint.js:1431 loads a level's exam with
-- .maybeSingle(), which THROWS on a second row. That guarantee moves from the
-- schema into code, and the same commit adds the matching filter
-- (source_quiz_id IS NULL for non-I-SAPS levels) so the assumption is enforced
-- where the query lives. A teacher-training refactor is planned; this is the
-- interim shape, not the destination.
BEGIN;

ALTER TABLE training_grand_quizzes
  DROP CONSTRAINT IF EXISTS training_grand_quizzes_level_id_quiz_type_key;

-- NULLS NOT DISTINCT: without it, two rows with a NULL source_quiz_id would
-- both be allowed on the same level, which is precisely the duplicate the old
-- constraint existed to prevent for every pre-I-SAPS vendor.
ALTER TABLE training_grand_quizzes
  ADD CONSTRAINT training_grand_quizzes_level_type_source_key
  UNIQUE NULLS NOT DISTINCT (level_id, quiz_type, source_quiz_id);

COMMENT ON COLUMN training_grand_quizzes.source_quiz_id IS
  'Legacy source id; for I-SAPS (bd-60119) 900 + module number, which is what '
  'allows one summative quiz per module rather than one per level.';

COMMIT;
