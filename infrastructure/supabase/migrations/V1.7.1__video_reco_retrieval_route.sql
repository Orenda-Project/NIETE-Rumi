-- V1.7.1 — video_recommendations: which retrieval route found the clip (bd-gzfdu9, SPEC v1.3 §3.6 R4).
-- Versioned migration, additive only. Applied per environment, in order. SANDBOX ONLY tonight.
--
-- WHAT. Three nullable columns on the V1.7.0 table. route: the route of the chosen chapter (of the list when
-- nothing was chosen) — tag (chapters tagged with the step indicator), step_text (BM25 over the card's own
-- words, only for a label / hole / unknown / empty target), card_text (no indicator at all). tag_mismatch: the
-- chosen chapter does not carry the step indicator (raw count reported beside differs_from_step; NULL when there
-- is no step indicator). step_text_query: the exact query the step-text route ran, for evals.
-- The candidates JSONB gains a per-entry `route` (no DDL: it is JSON).
--
-- WHY COLUMNS, NOT A TABLE. One value per recommendation row, read beside differs_from_step by evals and r-ab;
-- the row is the unit, so the row holds it (root CLAUDE.md rule 15).
-- DATA. Enumerations, a boolean, and the card's own wording (teacher-facing copy the bot wrote; no names, no phones).
-- LOAD. None beyond V1.7.0: same rows.
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS. Rollback: ROLLBACK_V1.7.1__video_reco_retrieval_route.sql
-- ORDER. Before the v1.3 engine is switched on; the v1.2.1 engine never writes these columns.

ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS route TEXT
  CHECK (route IN ('tag', 'step_text', 'card_text'));
ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS tag_mismatch BOOLEAN;
ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS step_text_query TEXT;

COMMENT ON COLUMN video_recommendations.route IS
  'bd-gzfdu9 v1.3: tag | step_text | card_text — the retrieval route of the chosen chapter (of the list on a none).';
COMMENT ON COLUMN video_recommendations.tag_mismatch IS
  'bd-gzfdu9 v1.3: the chosen chapter does not carry the step indicator; NULL without a step indicator.';
COMMENT ON COLUMN video_recommendations.step_text_query IS
  'bd-gzfdu9 v1.3: the query the step-text route ran (card action + try tomorrow + thing to try + indicator name).';

NOTIFY pgrst, 'reload schema';
