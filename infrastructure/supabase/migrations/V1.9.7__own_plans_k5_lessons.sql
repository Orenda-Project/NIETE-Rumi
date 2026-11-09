-- V1.9.7 — "Make my own" for grades 1–5: niete_lp612_own_plans names a 6-12 segment OR a grades 1–5 day (bd-snkn32.4).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. A grades 1–5 day has no 6-12 segment: its plan is the catalogue lesson (lesson_id, e.g. grade_3_urdu_ch1_seg2)
-- whose slide script the rewrite starts from. The EXISTING own-plan table is widened (docs/lesson-plan-data-model-debt.md:
-- no new LP table); lesson_id is the separator, and every row names exactly one of the two.
-- DATA CLASSIFICATION (D6): unchanged, '[Confidential]' (user_id + her note). lesson_id is a catalogue key, not PII.
-- OWNER (D7): NIETE-Rumi platform (bd-snkn32.4).
-- DATA. Existing rows all have segment_id, so the CHECK holds for them. LOAD. Unchanged. SECURITY. Unchanged (RLS on).
-- IDEMPOTENT. IF NOT EXISTS / DROP CONSTRAINT IF EXISTS. Rollback: ROLLBACK_V1.9.7__own_plans_k5_lessons.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS lesson_id TEXT;
ALTER TABLE niete_lp612_own_plans ALTER COLUMN segment_id DROP NOT NULL;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_one_parent;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_one_parent CHECK (num_nonnulls(segment_id, lesson_id) = 1);

COMMENT ON COLUMN niete_lp612_own_plans.lesson_id IS
  'Grades 1-5 day (lp_catalog lesson_id) her plan was rewritten from; NULL for a 6-12 fork (segment_id). Exactly one is set.';

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT count(*) FROM niete_lp612_own_plans WHERE num_nonnulls(segment_id, lesson_id) <> 1;  -- 0
