-- bd-u2td8 — restore the module order the import dropped.
--
-- WHAT IS WRONG
--   Six active courses carry duplicate module order_index values, and two carry
--   nothing else — all 14 modules of Beacon House "AI literacy" (course 48) and
--   all 14 of "AI Literacy" (course 53) sit at order_index = 1:
--
--     course  title                                   modules  distinct order_index
--     ------  --------------------------------------  -------  --------------------
--         48  AI literacy                                  14                     1
--         53  AI Literacy                                  14                     1
--         54  CS Foundations                               10                     9
--          5  Literacy 1        (NIETE, Aspiring)           9                     8
--         13  Literacy 1        (NIETE, Emerging)           8                     7
--         50  Conceptual Understanding & Science Proc       7                     6
--
--   Every one is module_unlock_logic='chain', so order decides what unlocks.
--   4,158 distinct teachers have progress in one of them.
--
-- WHY A BACKFILL IS POSSIBLE AT ALL
--   The intended order was never lost, only never mapped. source_module_id is
--   NOT NULL and distinct on all 62 modules across the six courses, and it runs
--   in the legacy platform's own sequence (course 48: 1049..1062). So this is
--   mechanical, not a judgement call — which is the only reason it is written as
--   a migration rather than handed to someone to decide.
--
--   Note the two orders genuinely differ. By id, course 48 opens with "AI for
--   Lesson Planning" (id 293). By source_module_id it opens with "AI Is a
--   Teaching Assistant" (1049) then "What is AI" (1050), "Model vs Agent",
--   "AI Literacy Framework" — which reads as the authored progression.
--
-- WHAT THIS DOES
--   Renumbers order_index 1..N per course, ordered by source_module_id, for
--   ACTIVE modules in courses that currently hold a tie. Nothing else is touched.
--
-- WHAT IT DOES NOT DO
--   It does not reorder a course that is already well-ordered, and it does not
--   invent an order for a module with no source_module_id (the guard aborts if
--   one exists rather than silently sorting NULLs).
--
-- BLAST RADIUS
--   teacher_training_progress keys on module_id, never on order_index, so no
--   teacher loses completion. What changes is WHICH not-yet-done module the
--   picker marks `next` — for the affected courses that is the point, since
--   today it is whatever the query plan happened to return.
--
--   Pair it with the code fix in this PR. The code makes the order STABLE; this
--   makes it RIGHT. Either alone is half the repair.
--
-- IDEMPOTENT: re-running is a no-op — the guard aborts once no course has a tie.

BEGIN;

-- ------------------------------------------------------------------ 1. guard
DO $$
DECLARE tied INT; orphan INT;
BEGIN
  SELECT count(*) INTO tied FROM (
    SELECT course_id FROM training_modules WHERE is_active
    GROUP BY course_id, order_index HAVING count(*) > 1) z;
  IF tied = 0 THEN
    RAISE EXCEPTION 'No course has a duplicate module order_index. Nothing to do.';
  END IF;

  -- Refuse to guess. If any module in an affected course lacks the legacy key,
  -- a human has to supply the order for that course.
  SELECT count(*) INTO orphan
  FROM training_modules m WHERE m.is_active AND m.source_module_id IS NULL
    AND m.course_id IN (
      SELECT course_id FROM training_modules WHERE is_active
      GROUP BY course_id, order_index HAVING count(*) > 1);
  IF orphan > 0 THEN
    RAISE EXCEPTION
      '% module(s) in an affected course have no source_module_id — order cannot be derived; resolve by hand', orphan;
  END IF;
END $$;

-- -------------------------------------------------------------- 2. renumber
WITH affected AS (
  SELECT DISTINCT course_id FROM training_modules WHERE is_active
  GROUP BY course_id, order_index HAVING count(*) > 1
),
seq AS (
  SELECT m.id,
         row_number() OVER (PARTITION BY m.course_id ORDER BY m.source_module_id) AS new_idx
  FROM training_modules m
  JOIN affected a ON a.course_id = m.course_id
  WHERE m.is_active
)
UPDATE training_modules m
   SET order_index = seq.new_idx
  FROM seq
 WHERE m.id = seq.id
   AND m.order_index IS DISTINCT FROM seq.new_idx;

-- ---------------------------------------------------------- 3. prove it took
-- ADD CONSTRAINT would validate for us, but there is no constraint here yet —
-- so assert explicitly rather than trusting the UPDATE's reasoning.
DO $$
DECLARE tied INT; gaps INT;
BEGIN
  SELECT count(*) INTO tied FROM (
    SELECT course_id FROM training_modules WHERE is_active
    GROUP BY course_id, order_index HAVING count(*) > 1) z;
  IF tied > 0 THEN
    RAISE EXCEPTION '% course(s) still hold a duplicate order_index — aborting', tied;
  END IF;

  -- Every active course must now run 1..N with no gap.
  SELECT count(*) INTO gaps FROM (
    SELECT course_id FROM training_modules WHERE is_active
    GROUP BY course_id
    HAVING min(order_index) <> 1 OR max(order_index) <> count(*)) z;
  IF gaps > 0 THEN
    RAISE EXCEPTION '% course(s) are not a contiguous 1..N sequence — aborting', gaps;
  END IF;
END $$;

COMMIT;

-- ----------------------------------------------------------------------------
-- WORTH DOING NEXT, in its own change: the reason levels are clean and modules
-- are not is that training_levels carries UNIQUE (vendor_id, order_index) and
-- training_modules carries no equivalent. Adding
--
--   CREATE UNIQUE INDEX CONCURRENTLY ux_training_modules_course_order
--     ON training_modules (course_id, order_index) WHERE is_active;
--
-- would stop this recurring. Not bundled here: it is a schema change, it needs
-- CONCURRENTLY outside a transaction, and it must not run until this backfill
-- has landed or it will simply fail on the existing ties.
