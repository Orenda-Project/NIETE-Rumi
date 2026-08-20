-- bd-43482 — unlock_logic was one column answering three questions.
--
-- `training_vendors.unlock_logic` ('chain' | 'all_modules') was read by three
-- unrelated concerns:
--
--   1. are LEVELS a ladder?    loadVisibleLevelsWithProgress (the chain gate)
--                              + isLadderVendor (display labels)
--   2. are MODULES sequential? annotateModuleLocks (bd-43477)
--   3. does this vendor certify per-module and use a capstone instead of an
--      MCQ grand quiz?         certificate.service + capstone-delivery.service
--
-- One column cannot answer them independently, and Beacon House needs
-- DIFFERENT answers to (1) and (2). Its "levels" are parallel SUBJECTS
-- (English / Mathematics / General Science / Computer Science) with no order
-- between them — but the modules INSIDE each subject are a real teaching
-- sequence ("What is AI?" before "Prompt Like A Pro"; vocabulary before
-- creative writing). bd-43477 bound both axes to the single flag and so
-- unlocked BH and Oxbridge modules wholesale, losing that sequence.
--
-- Policy (operator, 20 Aug 2026):
--
--   vendor        levels ordered?   modules ordered?
--   ------------  ----------------  ----------------
--   TALEEMABAD    yes  (chain)      yes  (chain)
--   OXBRIDGE      yes  (chain)      yes  (chain)      -- SESSION#1..#7
--   BEACONHOUSE   NO   (parallel)   yes  (chain)      -- subjects, not a ladder
--
-- So each axis gets its own column and `unlock_logic` is demoted to concern
-- (3) alone. Its VALUES ARE DELIBERATELY UNCHANGED here: it still routes
-- capstone-vs-grand-quiz and per-module certification, and Oxbridge must stay
-- 'all_modules' or it silently loses capstone eligibility the moment a
-- capstone row is added for it (it has none today).
--
-- Idempotent — safe to re-run.

ALTER TABLE training_vendors
  ADD COLUMN IF NOT EXISTS level_unlock_logic  TEXT NOT NULL DEFAULT 'chain',
  ADD COLUMN IF NOT EXISTS module_unlock_logic TEXT NOT NULL DEFAULT 'chain';

COMMENT ON COLUMN training_vendors.level_unlock_logic IS
  'Do this vendor''s LEVELS form an ordered ladder? ''chain'' = level N is '
  'gated behind level N-1''s exam. ''parallel'' = levels are independent '
  '(Beacon House subjects). Read by loadVisibleLevelsWithProgress.';

COMMENT ON COLUMN training_vendors.module_unlock_logic IS
  'Are the MODULES within one level sequential? ''chain'' = exactly one '
  'unpassed module open at a time. ''all_modules'' = every module open. '
  'Read by annotateModuleLocks. Independent of level_unlock_logic.';

COMMENT ON COLUMN training_vendors.unlock_logic IS
  'CERTIFICATION SEMANTICS ONLY (bd-43482). ''all_modules'' = closes a level '
  'with an open-ended capstone and may certify per module; ''chain'' = MCQ '
  'grand quiz. NOT the level/module ordering flags — see level_unlock_logic '
  'and module_unlock_logic.';

-- Level ordering: only Beacon House is parallel.
UPDATE training_vendors SET level_unlock_logic = 'chain'
  WHERE key IN ('TALEEMABAD', 'OXBRIDGE') AND level_unlock_logic <> 'chain';
UPDATE training_vendors SET level_unlock_logic = 'parallel'
  WHERE key = 'BEACONHOUSE' AND level_unlock_logic <> 'parallel';

-- Module ordering: every vendor sequences its modules.
UPDATE training_vendors SET module_unlock_logic = 'chain'
  WHERE module_unlock_logic <> 'chain';

-- Verify:
--   SELECT key, unlock_logic, level_unlock_logic, module_unlock_logic
--   FROM training_vendors ORDER BY key;
-- Expect:
--   BEACONHOUSE  all_modules | parallel | chain
--   OXBRIDGE     all_modules | chain    | chain
--   TALEEMABAD   chain       | chain    | chain
