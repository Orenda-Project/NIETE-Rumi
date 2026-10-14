-- ROLLBACK V1.6.6 — niete_lp_assets_card_kind (reverses migration V1.6.6).
-- destructive: reviewed — deletes only the v10 card rows V1.6.6 allowed; no download row points at
-- them (downloads are recorded against the v9 lesson). The card PDFs stay in R2. Switch the test off
-- (ab_v10_enabled = false) first; with no card rows every teacher gets v9 anyway.
BEGIN;
DELETE FROM niete_lp_assets WHERE asset_kind = 'card';
ALTER TABLE niete_lp_assets DROP CONSTRAINT IF EXISTS niete_lp_assets_asset_kind_check;
ALTER TABLE niete_lp_assets ADD CONSTRAINT niete_lp_assets_asset_kind_check
  CHECK (asset_kind IN ('lesson', 'answer_key'));
COMMIT;
