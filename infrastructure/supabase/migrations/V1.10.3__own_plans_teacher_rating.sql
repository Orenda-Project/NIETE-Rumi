-- V1.10.3 — "Make my own": her own rating of her own plan (bd-snkn32.11, queue #134 C).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. #120: own plans had no rating at all, so no later fix could be aimed at what teachers found weak. Her plan's
-- page now asks "how good was this plan?" (1-5) and, optionally, "what was confusing?". The EXISTING own-plan table is
-- widened (docs/lesson-plan-data-model-debt.md: no new LP table). Not lp_feedback: its yes/no "useful" is the ready-made
-- plans' survey and feeds the daily ICT plan-quality panel, which own-plan ratings must not skew.
-- DATA CLASSIFICATION (D6): unchanged, '[Confidential]'. teacher_confusing is her own free text about the plan (no
-- name or phone asked for); the shelf read (lp612-own-library) selects none of these columns.
-- OWNER (D7): NIETE-Rumi platform.
-- DATA. Existing rows: all NULL (not rated). LOAD. One UPDATE per rating, by id and her user id. SECURITY. Unchanged
-- (RLS on, service role only).
-- IDEMPOTENT. IF NOT EXISTS / DROP CONSTRAINT IF EXISTS. Rollback: ROLLBACK_V1.10.3__own_plans_teacher_rating.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS teacher_rating SMALLINT;
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS teacher_confusing TEXT;
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS teacher_rated_at TIMESTAMPTZ;

ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_teacher_rating_range;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_teacher_rating_range
  CHECK (teacher_rating IS NULL OR teacher_rating BETWEEN 1 AND 5);
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_teacher_confusing;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_teacher_confusing
  CHECK (teacher_confusing IS NULL OR (teacher_rating IS NOT NULL AND char_length(teacher_confusing) <= 300));
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_teacher_rated_when;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_teacher_rated_when
  CHECK ((teacher_rating IS NULL) = (teacher_rated_at IS NULL));

COMMENT ON COLUMN niete_lp612_own_plans.teacher_rating IS 'Her rating of her own plan, 1-5; NULL = not rated.';
COMMENT ON COLUMN niete_lp612_own_plans.teacher_confusing IS 'Optional: what she found confusing (max 300 chars); only with a rating.';
COMMENT ON COLUMN niete_lp612_own_plans.teacher_rated_at IS 'When she last rated it.';

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT count(*) FROM niete_lp612_own_plans WHERE teacher_rating IS NOT NULL;  -- 0
