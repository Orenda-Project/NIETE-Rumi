-- ═══════════════════════════════════════════════════════════════════════════
-- FOLD DUPLICATE COACH-TO-SCHOOL ROWS
--
-- A coach holding the same school twice, because one of the two rows carries a
-- mis-typed EMIS. Detection is by (leader_user_id, canonical school_name), so
-- nothing here depends on knowing which EMIS is correct. The keeper is the row
-- holding more teachers, ties broken by age.
--
-- This must run BEFORE the school_id backfill, not after. A dry run against
-- production showed why: backfilled first, the Dhoke Paracha duplicate resolves
-- to the GIRLS school (its EMIS and its one teacher's own record both say 628)
-- and therefore never collides, so no constraint would ever surface it.
--
-- The two teacher rows are NOT symmetric and a single loop breaks:
--   · a teacher not yet on the keeper must be MOVED
--   · a teacher already on the keeper must be DELETED, because moving them
--     violates leader_teachers' UNIQUE (leader_user_id, source, school_ext_id,
--     teacher_ext_id)
--
-- Assertions run on both sides. Any surprise raises and the whole thing rolls
-- back. Counts are read live, never hardcoded.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

\echo '=== row-level backup BEFORE anything (rollback path) ==='
\copy (SELECT * FROM leader_schools) TO 'backup_leader_schools.csv' CSV HEADER
\copy (SELECT * FROM leader_teachers) TO 'backup_leader_teachers.csv' CSV HEADER
\copy (SELECT * FROM observation_schedules) TO 'backup_observation_schedules.csv' CSV HEADER

BEGIN;

\echo ''
\echo '=== build the merge plan from the data, not from a list of ids ==='
CREATE TEMP TABLE merge_plan AS
WITH canon AS (
  SELECT ls.id, ls.leader_user_id, ls.school_ext_id, ls.school_name, ls.created_at,
         UPPER(REGEXP_REPLACE(ls.school_name,'[^a-zA-Z0-9]','','g')) AS cname,
         (SELECT count(*) FROM leader_teachers lt
           WHERE lt.leader_user_id = ls.leader_user_id
             AND lt.school_ext_id  = ls.school_ext_id) AS teachers
    FROM leader_schools ls
), ranked AS (
  SELECT c.*, row_number() OVER (PARTITION BY c.leader_user_id, c.cname
                                 ORDER BY c.teachers DESC, c.created_at ASC) AS rk,
            count(*)     OVER (PARTITION BY c.leader_user_id, c.cname) AS in_group
    FROM canon c
)
SELECT l.id            AS loser_id,
       l.school_ext_id AS loser_ext,
       l.teachers      AS loser_teachers,
       k.id            AS keeper_id,
       k.school_ext_id AS keeper_ext,
       k.teachers      AS keeper_teachers,
       l.leader_user_id,
       l.cname,
       l.school_name
  FROM ranked l
  JOIN ranked k ON k.leader_user_id = l.leader_user_id AND k.cname = l.cname AND k.rk = 1
 WHERE l.in_group > 1 AND l.rk > 1;

SELECT loser_ext, loser_teachers, '->' AS fold_into, keeper_ext, keeper_teachers, school_name
  FROM merge_plan ORDER BY school_name;

\echo ''
\echo '=== PRE-FLIGHT assertions ==='
DO $$
DECLARE n_plan int; n_selfref int; n_keeper_smaller int;
BEGIN
  SELECT count(*) INTO n_plan FROM merge_plan;
  IF n_plan = 0 THEN RAISE EXCEPTION 'nothing to merge; refusing to run'; END IF;

  -- a keeper must never also be a loser
  SELECT count(*) INTO n_selfref FROM merge_plan m
   WHERE m.keeper_id IN (SELECT loser_id FROM merge_plan);
  IF n_selfref > 0 THEN RAISE EXCEPTION 'plan is inconsistent: % keeper(s) also listed as losers', n_selfref; END IF;

  -- we must never fold the bigger roster into the smaller one
  SELECT count(*) INTO n_keeper_smaller FROM merge_plan WHERE keeper_teachers < loser_teachers;
  IF n_keeper_smaller > 0 THEN RAISE EXCEPTION 'plan would discard the larger roster in % case(s)', n_keeper_smaller; END IF;

  RAISE NOTICE 'pre-flight ok: % pair(s) to fold', n_plan;
END $$;

\echo ''
\echo '=== capture the populations that must NOT change ==='
CREATE TEMP TABLE untouched_before AS
SELECT lt.school_ext_id, lt.leader_user_id, count(*) AS rows
  FROM leader_teachers lt
 WHERE lt.school_ext_id IN (SELECT loser_ext FROM merge_plan)
   AND (lt.leader_user_id, lt.school_ext_id) NOT IN (SELECT leader_user_id, loser_ext FROM merge_plan)
 GROUP BY 1,2;

CREATE TEMP TABLE totals_before AS
SELECT (SELECT count(*) FROM leader_schools)  AS ls,
       (SELECT count(*) FROM leader_teachers) AS lt;

\echo ''
\echo '=== 1. MOVE teachers who are not yet on the keeper ==='
UPDATE leader_teachers lt
   SET school_ext_id = m.keeper_ext
  FROM merge_plan m
 WHERE lt.leader_user_id = m.leader_user_id
   AND lt.school_ext_id  = m.loser_ext
   AND NOT EXISTS (
     SELECT 1 FROM leader_teachers x
      WHERE x.leader_user_id = lt.leader_user_id
        AND x.source         = lt.source
        AND x.school_ext_id  = m.keeper_ext
        AND x.teacher_ext_id = lt.teacher_ext_id);

\echo '=== 2. DELETE the ones that were already on the keeper (true duplicates) ==='
DELETE FROM leader_teachers lt
 USING merge_plan m
 WHERE lt.leader_user_id = m.leader_user_id
   AND lt.school_ext_id  = m.loser_ext;

\echo '=== 3. RE-KEY any scheduled or completed visits on the losing ext id ==='
UPDATE observation_schedules os
   SET school_ext_id = m.keeper_ext, updated_at = now()
  FROM merge_plan m
 WHERE os.leader_user_id = m.leader_user_id
   AND os.school_ext_id  = m.loser_ext;

\echo '=== 4. DELETE the duplicate coach-to-school rows ==='
DELETE FROM leader_schools ls
 USING merge_plan m
 WHERE ls.id = m.loser_id;

\echo ''
\echo '=== POST-FLIGHT assertions ==='
DO $$
-- Every variable is v_-prefixed on purpose. plpgsql substitutes declared names
-- into SQL text, so a variable called `b` shadows a table alias called `b` and
-- the query fails with "record is not assigned yet". That is what aborted the
-- first staging run; the transaction rolled back and nothing was half-applied.
#variable_conflict use_column
DECLARE
  v_dup int; v_loser_rows int; v_orphan int; v_drift int;
  v_ls_before int; v_lt_before int; v_ls_after int; v_lt_after int; v_planned int;
BEGIN
  -- no coach holds the same canonical school name twice any more
  SELECT count(*) INTO v_dup FROM (
    SELECT leader_user_id, UPPER(REGEXP_REPLACE(school_name,'[^a-zA-Z0-9]','','g'))
      FROM leader_schools GROUP BY 1,2 HAVING count(*) > 1) q;
  IF v_dup > 0 THEN RAISE EXCEPTION 'POST: % duplicate (coach, name) group(s) remain', v_dup; END IF;

  -- the losing rows are gone, and so are their teacher rows
  SELECT count(*) INTO v_loser_rows FROM leader_schools
   WHERE id IN (SELECT loser_id FROM merge_plan);
  IF v_loser_rows > 0 THEN RAISE EXCEPTION 'POST: % losing row(s) survived', v_loser_rows; END IF;

  SELECT count(*) INTO v_orphan FROM leader_teachers lt
    JOIN merge_plan mp ON mp.leader_user_id=lt.leader_user_id AND mp.loser_ext=lt.school_ext_id;
  IF v_orphan > 0 THEN RAISE EXCEPTION 'POST: % teacher row(s) still on a losing ext id', v_orphan; END IF;

  -- every teacher row still has a parent
  SELECT count(*) INTO v_orphan FROM leader_teachers lt
   WHERE NOT EXISTS (SELECT 1 FROM leader_schools ls
                      WHERE ls.leader_user_id=lt.leader_user_id
                        AND ls.school_ext_id =lt.school_ext_id);
  IF v_orphan > 0 THEN RAISE EXCEPTION 'POST: % teacher row(s) now have no parent school row', v_orphan; END IF;

  -- other coaches at those ext ids are untouched
  SELECT count(*) INTO v_drift
    FROM untouched_before ub
    JOIN (SELECT school_ext_id, leader_user_id, count(*) AS rows
            FROM leader_teachers
           WHERE school_ext_id IN (SELECT loser_ext FROM merge_plan)
           GROUP BY 1,2) nowc
      ON nowc.school_ext_id = ub.school_ext_id
     AND nowc.leader_user_id = ub.leader_user_id
   WHERE nowc.rows <> ub.rows;
  IF v_drift > 0 THEN RAISE EXCEPTION 'POST: % other-coach population(s) changed', v_drift; END IF;

  -- exactly as many leader_schools rows removed as we planned to remove
  SELECT ls, lt INTO v_ls_before, v_lt_before FROM totals_before;
  SELECT count(*) INTO v_ls_after FROM leader_schools;
  SELECT count(*) INTO v_lt_after FROM leader_teachers;
  SELECT count(*) INTO v_planned  FROM merge_plan;
  IF v_ls_before - v_ls_after <> v_planned THEN
    RAISE EXCEPTION 'POST: leader_schools fell by %, expected %', v_ls_before - v_ls_after, v_planned;
  END IF;

  RAISE NOTICE 'post-flight ok: leader_schools % -> %, leader_teachers % -> %',
    v_ls_before, v_ls_after, v_lt_before, v_lt_after;
END $$;

COMMIT;

\echo ''
\echo '=== AFTER COMMIT: independent verification ==='
SELECT school_ext_id, school_name,
       (SELECT count(*) FROM leader_teachers lt
         WHERE lt.leader_user_id=ls.leader_user_id AND lt.school_ext_id=ls.school_ext_id) AS teachers
  FROM leader_schools ls
 WHERE ls.school_ext_id IN ('niete:607','niete:620','niete:628','niete:632')
 ORDER BY ls.school_ext_id, ls.school_name;

SELECT school_ext_id, count(*) AS teacher_rows, count(DISTINCT leader_user_id) AS coaches
  FROM leader_teachers WHERE school_ext_id IN ('niete:607','niete:620','niete:628','niete:632')
 GROUP BY 1 ORDER BY 1;

SELECT count(*) AS remaining_duplicate_groups FROM (
  SELECT leader_user_id, UPPER(REGEXP_REPLACE(school_name,'[^a-zA-Z0-9]','','g'))
    FROM leader_schools GROUP BY 1,2 HAVING count(*) > 1) q;

SELECT (SELECT count(*) FROM leader_schools) AS leader_schools,
       (SELECT count(*) FROM leader_teachers) AS leader_teachers;
