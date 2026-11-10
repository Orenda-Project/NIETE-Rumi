-- V1.9.8 — "Change this plan": a teacher may change her finished own plan up to two times (bd-snkn32.15).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. A change is one more generation (~$0.24-0.36), so it is a new row of the EXISTING own-plan table
-- (docs/lesson-plan-data-model-debt.md: no new LP table) pointing at the ROOT plan she first made. The cap of two is held
-- by the database, not only the service: edit_round is 1 or 2, and (root, round) is unique among rows that did not fail,
-- so two taps at once cannot both start round 1. A failed round frees its slot so she can try again.
-- DATA CLASSIFICATION (D6): unchanged, '[Confidential]' (user_id + her note). edit_request holds the part she picked and
-- the words she typed (<= 300 chars), same class as answers.
-- OWNER (D7): NIETE-Rumi platform (bd-snkn32.15).
-- DATA. Existing rows are roots (all three columns NULL), so the CHECK holds. LOAD. Unchanged. SECURITY. Unchanged (RLS on).
-- IDEMPOTENT. IF NOT EXISTS / DROP CONSTRAINT IF EXISTS. Rollback: ROLLBACK_V1.9.8__own_plans_changes.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS parent_own_id UUID REFERENCES niete_lp612_own_plans(id);
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS edit_round SMALLINT;
ALTER TABLE niete_lp612_own_plans ADD COLUMN IF NOT EXISTS edit_request JSONB;
ALTER TABLE niete_lp612_own_plans DROP CONSTRAINT IF EXISTS niete_lp612_own_plans_edit_round;
ALTER TABLE niete_lp612_own_plans ADD CONSTRAINT niete_lp612_own_plans_edit_round CHECK (
  (parent_own_id IS NULL AND edit_round IS NULL AND edit_request IS NULL)
  OR (parent_own_id IS NOT NULL AND edit_round IN (1, 2) AND edit_request IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lp612_own_plans_round
  ON niete_lp612_own_plans (parent_own_id, edit_round) WHERE status <> 'failed';

COMMENT ON COLUMN niete_lp612_own_plans.parent_own_id IS
  'Change this plan: the ROOT own plan this change belongs to; NULL on the root itself.';
COMMENT ON COLUMN niete_lp612_own_plans.edit_round IS
  'Change this plan: 1 or 2. Unique per root among rows that did not fail (uq_lp612_own_plans_round).';
COMMENT ON COLUMN niete_lp612_own_plans.edit_request IS
  'Change this plan: {part, text} she asked for; the rewrite starts from the latest ready plan in the chain.';

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT parent_own_id, count(*) FROM niete_lp612_own_plans WHERE parent_own_id IS NOT NULL AND status <> 'failed' GROUP BY 1 HAVING count(*) > 2;  -- 0 rows
