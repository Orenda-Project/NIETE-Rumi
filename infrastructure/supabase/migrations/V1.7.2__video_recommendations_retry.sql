-- V1.7.2 — video_recommendations: the one bounded validation retry (bd-gzfdu9, SPEC v1.3b, lead-review 19:49Z ruling 4).
-- Versioned migration, additive only. Applied per environment, in order. SANDBOX ONLY.
--
-- WHAT. Two nullable columns on the V1.7.0 table. attempts: how many completeJson calls the pick took (1, or 2 when
-- the first answer failed validation and ≥ 20 s of the engine budget was left). first_none_reason: the
-- `validation:<why>` the first answer failed on, kept when the retry is accepted or fails too (NULL on one attempt).
--
-- WHY COLUMNS, NOT A TABLE. One value per recommendation row, read beside none_reason by evals ("validation nones
-- that gold accepts"); the row is the unit, so the row holds it (root CLAUDE.md rule 15).
-- DATA. A small integer and an enumerated reason string. No names, no phones, no teacher text.
-- LOAD. None beyond V1.7.0: same rows.
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS. Rollback: ROLLBACK_V1.7.2__video_recommendations_retry.sql
-- ORDER. After V1.7.1, before the v1.3b engine is switched on; the earlier engines never write these columns.

ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS attempts SMALLINT
  CHECK (attempts IS NULL OR attempts IN (1, 2));
ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS first_none_reason TEXT;

COMMENT ON COLUMN video_recommendations.attempts IS
  'bd-gzfdu9 v1.3b: completeJson calls for the pick — 1, or 2 after one bounded validation retry; NULL when no call was made.';
COMMENT ON COLUMN video_recommendations.first_none_reason IS
  'bd-gzfdu9 v1.3b: the validation:<why> the first answer failed on when a retry ran; NULL otherwise.';

NOTIFY pgrst, 'reload schema';
