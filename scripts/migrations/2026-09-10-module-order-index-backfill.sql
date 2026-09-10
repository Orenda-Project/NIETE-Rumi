-- bd-u2td8 — give the two courses that have NO module order one.
--
-- SCOPE, AND WHY IT IS THIS NARROW
--   Six active courses hold a duplicate module order_index. Only two of them
--   have no order at all — every module on one value:
--
--     course  title                    modules  distinct order_index
--     ------  -----------------------  -------  --------------------
--         48  AI literacy (BH)              14                     1
--         53  AI Literacy (BH)              14                     1
--
--   The other four (5, 13, 50, 54) each carry a real sequence with a single
--   duplicated pair. An earlier draft of this migration renumbered all six by
--   source_module_id and would have MOVED 8 of course 13's 8 modules — throwing
--   away a working order to fix one collision. They are deliberately left alone:
--   the code change in this PR already makes them deterministic, and resolving
--   one duplicated pair is a content decision, not a bulk rewrite.
--
-- HOW THE ORDER IS DERIVED, AND HOW FAR TO TRUST IT
--   By source_module_id, the legacy platform's own key. Courses 48 and 53 run
--   1049..1062 and 1063..1076, so it produces a clean, plausible progression:
--   "AI Is a Teaching Assistant", "What is AI", "Model vs Agent", "AI Literacy
--   Framework"... rather than today's effective id order, which opens on
--   "AI for Lesson Planning".
--
--   Be honest about the strength of that: measured against the 46 courses that
--   ARE well ordered, source_module_id order agrees with their order_index for
--   215 of 297 modules — 72%. So it is a good proxy, not the authored sequence.
--   For these two courses the alternative is no order whatsoever, so 72% is a
--   clear improvement; for a course that already has one it would not be, which
--   is the whole reason for the narrow scope above.
--
--   ⚠️ Worth a content person's eye on the resulting order for 48 and 53 before
--   this is treated as final. It is defensible, not authoritative.
--
-- BLAST RADIUS
--   teacher_training_progress keys on module_id, never order_index, so nobody
--   loses completion. What changes is which not-yet-done module the picker calls
--   `next` — which today is whatever the query plan returned.
--
-- IDEMPOTENT: the guard aborts once neither course has a tie.

BEGIN;

-- Courses with a duplicate order_index AND no ordering information at all.
CREATE TEMP TABLE _targets ON COMMIT DROP AS
  SELECT course_id
    FROM training_modules
   WHERE is_active
   GROUP BY course_id
  HAVING count(*) > 1 AND count(DISTINCT order_index) = 1;

-- ------------------------------------------------------------------ 1. guard
DO $$
DECLARE n INT; orphan INT;
BEGIN
  SELECT count(*) INTO n FROM _targets;
  IF n = 0 THEN
    RAISE EXCEPTION 'No course has an entirely-unordered module set. Nothing to do.';
  END IF;

  -- Refuse to guess rather than silently sorting NULLs to one end.
  SELECT count(*) INTO orphan
    FROM training_modules m JOIN _targets t ON t.course_id = m.course_id
   WHERE m.is_active AND m.source_module_id IS NULL;
  IF orphan > 0 THEN
    RAISE EXCEPTION '% module(s) have no source_module_id — order cannot be derived', orphan;
  END IF;
END $$;

-- -------------------------------------------------------------- 2. renumber
WITH seq AS (
  SELECT m.id,
         row_number() OVER (PARTITION BY m.course_id ORDER BY m.source_module_id) AS new_idx
    FROM training_modules m
    JOIN _targets t ON t.course_id = m.course_id
   WHERE m.is_active
)
UPDATE training_modules m
   SET order_index = seq.new_idx
  FROM seq
 WHERE m.id = seq.id
   AND m.order_index IS DISTINCT FROM seq.new_idx;

-- ---------------------------------------------------------- 3. prove it took
-- Scoped to the targets ON PURPOSE. Nine active courses are non-contiguous
-- today (gaps, not ties) and six of those are none of this migration's business
-- — an earlier draft asserted contiguity across EVERY active course and would
-- have aborted itself on unrelated data every single time it ran.
DO $$
DECLARE bad INT;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT m.course_id
      FROM training_modules m JOIN _targets t ON t.course_id = m.course_id
     WHERE m.is_active
     GROUP BY m.course_id
    HAVING count(*) <> count(DISTINCT m.order_index)
        OR min(m.order_index) <> 1
        OR max(m.order_index) <> count(*)) z;
  IF bad > 0 THEN
    RAISE EXCEPTION '% target course(s) are still not a clean 1..N — aborting', bad;
  END IF;
END $$;

COMMIT;

-- ----------------------------------------------------------------------------
-- AFTERWARDS, separately: training_levels carries UNIQUE (vendor_id,
-- order_index) and training_modules carries no equivalent, which is exactly why
-- levels are clean and modules are not.
--
--   CREATE UNIQUE INDEX CONCURRENTLY ux_training_modules_course_order
--     ON training_modules (course_id, order_index) WHERE is_active;
--
-- Not bundled: it needs CONCURRENTLY (so, outside a transaction) and it would
-- fail today against the four courses this migration deliberately does not fix.
