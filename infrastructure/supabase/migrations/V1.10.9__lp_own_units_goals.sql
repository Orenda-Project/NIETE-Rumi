-- V1.10.9 — "A whole unit" from learning goals with NO textbook (bd-snkn32.59.4, queue #165 phase 2).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. Amena, 20 Nov: "learning goals wont be related to the textbook, it could be any few goals that need a plan,
-- pls dont link the textbook for learning goals". A goal unit is her 2-8 goals (picked from the skill list or typed),
-- split into days from those goals alone. So:
--   1. niete_lp_own_units.goal_codes → goals: it holds her goals' WORDS (a typed goal has no code), in her order.
--   2. book_stem is no longer required: a goal unit names no book (a book unit still must).
--   3. niete_lp612_own_plans: a day plan of a goal unit names no segment and no book day. The one-parent check
--      allows exactly that row (answers.unit.start = 'goals'); every other row still names exactly one.
-- No new table, no new column on niete_lp612_own_plans (docs/lesson-plan-data-model-debt.md).
-- DATA CLASSIFICATION (D6): niete_lp_own_units becomes '[Confidential]' (user_id + her own typed goal words, as
-- niete_lp612_own_plans.answers holds her note). Blocked words never reach it (lp-own-goal-guard, server-side).
-- OWNER (D7): NIETE-Rumi platform (bd-snkn32.59.4).
-- DATA. niete_lp_own_units is empty on every database it exists on (staging, sandbox; never live); goal_codes was
-- never written (no goal unit existed). Existing own-plan rows all name one parent, so the wider CHECK holds.
-- LOAD. Unchanged. SECURITY. Unchanged (RLS on, service role only).
-- IDEMPOTENT. Guarded rename, DROP ... IF EXISTS before each ADD. Rollback: ROLLBACK_V1.10.9__lp_own_units_goals.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='niete_lp_own_units' AND column_name='goal_codes')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='niete_lp_own_units' AND column_name='goals') THEN
    ALTER TABLE niete_lp_own_units RENAME COLUMN goal_codes TO goals;
  END IF;
END $$;

ALTER TABLE niete_lp_own_units ALTER COLUMN book_stem DROP NOT NULL;
ALTER TABLE niete_lp_own_units DROP CONSTRAINT IF EXISTS niete_lp_own_units_goals;
ALTER TABLE niete_lp_own_units ADD CONSTRAINT niete_lp_own_units_goals
  CHECK (start_kind <> 'goals' OR (cardinality(goals) BETWEEN 2 AND 8 AND book_stem IS NULL AND chapter_from IS NULL));
ALTER TABLE niete_lp_own_units DROP CONSTRAINT IF EXISTS niete_lp_own_units_book;
ALTER TABLE niete_lp_own_units ADD CONSTRAINT niete_lp_own_units_book CHECK (start_kind <> 'book' OR book_stem IS NOT NULL);

COMMENT ON COLUMN niete_lp_own_units.goals IS
  'A goal unit''s goals, her words, in her order (2-8). No textbook link: no chapter, page or book day. NULL for a book unit.';
COMMENT ON TABLE niete_lp_own_units IS
  'Make my own, a whole unit: a teacher''s day-by-day outline (book chapters, or her goals with no book; period, pace). [Confidential]: her own goal words. No plan bodies: each day''s plan is a niete_lp612_own_plans row with answers.unit.';

ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_one_parent;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_one_parent CHECK (
  num_nonnulls(segment_id, lesson_id) = 1
  OR (segment_id IS NULL AND lesson_id IS NULL AND answers->'unit'->>'start' = 'goals')
);

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT column_name FROM information_schema.columns WHERE table_name='niete_lp_own_units' AND column_name='goals';  -- 1 row
-- post-flight: SELECT count(*) FROM niete_lp612_own_plans WHERE num_nonnulls(segment_id, lesson_id) <> 1;  -- 0
