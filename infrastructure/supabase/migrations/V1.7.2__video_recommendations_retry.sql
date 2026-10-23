-- V1.7.2 — video_recommendations: the one bounded validation retry (bd-gzfdu9, SPEC v1.3b, lead-review 19:49Z ruling 4).
-- Versioned migration, additive only. Applied per environment, in order. SANDBOX ONLY.
--
-- WHAT. Two nullable columns on the V1.7.0 table. attempts: how many completeJson calls the pick took (1, or 2 when
-- the first answer failed validation and ≥ 20 s of the engine budget was left). first_none_reason: the
-- `validation:<why>` the first answer failed on, kept when the retry is accepted or fails too (NULL on one attempt).
-- r-ab EVENTS_SCHEMA §3b (PREREG v1.2 §8 STOP_lang_null): report_language_null = users.preferred_language was null at
-- write time; lesson_language = the transcript language the engine used (en|ur, NULL when unknown and the teacher has
-- a stored language); chapter_language = the picked chapter's spoken language (en|ur|mixed, NULL on a none). Written
-- on every row that made an LLM call.
--
-- WHY COLUMNS, NOT A TABLE. One value per recommendation row, read beside none_reason by evals ("validation nones
-- that gold accepts"); the row is the unit, so the row holds it (root CLAUDE.md rule 15).
-- DATA. A small integer, a boolean and enumerated strings. No names, no phones, no teacher text.
-- LOAD. None beyond V1.7.0: same rows.
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS. Rollback: ROLLBACK_V1.7.2__video_recommendations_retry.sql
-- ORDER. After V1.7.1, before the v1.3b engine is switched on; the earlier engines never write these columns.

ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS attempts SMALLINT
  CHECK (attempts IS NULL OR attempts IN (1, 2));
ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS first_none_reason TEXT;
ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS report_language_null BOOLEAN;
ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS lesson_language TEXT
  CHECK (lesson_language IS NULL OR lesson_language IN ('en', 'ur'));
ALTER TABLE video_recommendations ADD COLUMN IF NOT EXISTS chapter_language TEXT
  CHECK (chapter_language IS NULL OR chapter_language IN ('en', 'ur', 'mixed'));

COMMENT ON COLUMN video_recommendations.attempts IS
  'bd-gzfdu9 v1.3b: completeJson calls for the pick — 1, or 2 after one bounded validation retry; NULL when no call was made.';
COMMENT ON COLUMN video_recommendations.first_none_reason IS
  'bd-gzfdu9 v1.3b: the validation:<why> the first answer failed on when a retry ran; NULL otherwise.';
COMMENT ON COLUMN video_recommendations.report_language_null IS
  'bd-gzfdu9 v1.3b (r-ab §3b): users.preferred_language was null when the row was written.';
COMMENT ON COLUMN video_recommendations.lesson_language IS
  'bd-gzfdu9 v1.3b (r-ab §3b): the transcript language the engine used (en|ur); NULL when unknown with a stored language.';
COMMENT ON COLUMN video_recommendations.chapter_language IS
  'bd-gzfdu9 v1.3b (r-ab §3b): the picked chapter''s spoken language; NULL on a none.';

NOTIFY pgrst, 'reload schema';
