-- V1.6.6 — niete_lp_assets may hold a 'card' row: the v10 lesson card for the ICT G1-5 v10 coaching
-- test (bd-v0toag.50.1). Versioned migration, applied per environment in order.
--
-- WHAT. Widens the asset_kind CHECK from (lesson, answer_key) to (lesson, answer_key, card). Nothing
-- else. The one-current index is per (lesson_id, asset_kind), so a current card sits beside the current
-- v9 lesson and never supersedes it: everyone keeps getting v9, and plan-arm v10 schools (B, D) are sent
-- the card by bot/shared/services/lp-v10-card.service.js. The download row stays on the v9 lesson.
--
-- WHY NOT A NEW TABLE. The card is a version of the same lesson PDF, keyed and served exactly like one;
-- a kind is the existing seam (answer_key is the precedent).
--
-- IDEMPOTENT. The original CHECK was declared inline and so has a generated name; it is found by
-- definition in pg_constraint and dropped, then the named CHECK is re-added. Re-running is a no-op.
-- LOAD. A CHECK re-validation over ~3k rows, once.
-- ORDER. Safe either side of the code: with no card rows, lp-v10-card finds nothing and sends v9.
-- Rollback: ROLLBACK_V1.6.6__niete_lp_assets_card_kind.sql

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'niete_lp_assets'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%asset_kind%'
  LOOP
    EXECUTE format('ALTER TABLE niete_lp_assets DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE niete_lp_assets DROP CONSTRAINT IF EXISTS niete_lp_assets_asset_kind_check;
ALTER TABLE niete_lp_assets ADD CONSTRAINT niete_lp_assets_asset_kind_check
  CHECK (asset_kind IN ('lesson', 'answer_key', 'card'));
