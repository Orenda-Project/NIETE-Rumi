-- V1.5.2 — niete_lp_asset_sources: the slide script of the EXACT lesson version served.
--
-- Applied once, in version order, and recorded in the schema_versions ledger.
--
-- A quiz can be written from a lesson plan only if we hold the text of the PDF the
-- teacher actually received. Three candidate artefacts were measured over every
-- lesson taken in the seven days to 22 Sep 2026 (1,211 lessons):
--
--   * the matrix's LP link == the object the bot serves ....... 1,211 / 1,211
--   * the published slide script's key fact on the served PDF
--     (OCR, English-script lessons) ........................... 50 / 50
--   * the stable-path enrichment byte-identical to the
--     content-addressed trace ................................. 250 / 1,211  (stale for 79%)
--
-- So the slide script is the text of the served PDF, and neither enrichment copy is
-- safe to quiz from. This table is where that script is ingested, bound to the
-- version triple the asset carries, so a quiz is never written from a lesson plan
-- the teacher does not hold.
--
-- Shape notes:
--   asset_id PK -> niete_lp_assets(id) ON DELETE CASCADE
--       one source row per asset. The cascade means a deleted asset can never leave
--       a dangling script behind for a later quiz to pick up.
--   UNIQUE (lesson_id, version_stamp, content_hash)
--       the upsert key, identical to the key niete_lp_fidelity_moves uses. Both the
--       upload path and the backfill write through it, so re-running either is a
--       no-op rather than a duplicate the resolver would pick between at random.
--   verified NOT NULL
--       how we know this script belongs to that PDF:
--         'upload'            written beside the PDF by the renderer in the same run
--         'backfill:link'     the matrix row whose LP link IS the served object
--         'backfill:link+ocr' the same, with the served PDF's text checked as well
--       Nullable would let an unprovenanced row look exactly like a proven one.
--
-- No column here is personal data: a lesson id, a version, a hash, and the lesson text.
--
-- Load: one row per lesson version (~1,300 current lesson assets on sandbox), read by
-- primary key, one row per quiz. slide_script is ~13 KB of jsonb.
--
-- SAFE TO RE-RUN. Additive only: no column is dropped, altered or renamed, and
-- nothing outside this table is touched.

CREATE TABLE IF NOT EXISTS niete_lp_asset_sources (
  asset_id      uuid PRIMARY KEY REFERENCES niete_lp_assets(id) ON DELETE CASCADE,
  lesson_id     text NOT NULL,
  version_stamp text NOT NULL,
  content_hash  text NOT NULL,
  slide_script  jsonb NOT NULL,
  source_url    text,
  verified      text NOT NULL,            -- 'upload' | 'backfill:link' | 'backfill:link+ocr'
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT niete_lp_asset_sources_version_uniq UNIQUE (lesson_id, version_stamp, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_niete_lp_asset_sources_lesson ON niete_lp_asset_sources (lesson_id);

-- ----------------------------------------------------------------------------
-- VERIFY (read-only):
--   SELECT count(*) FROM niete_lp_asset_sources;
--   SELECT verified, count(*) FROM niete_lp_asset_sources GROUP BY 1 ORDER BY 2 DESC;
--   -- every source row bound to the asset the bot currently serves:
--   SELECT count(*) FROM niete_lp_asset_sources s
--     JOIN niete_lp_assets a ON a.id = s.asset_id
--    WHERE a.is_current AND a.asset_kind = 'lesson'
--      AND a.content_hash = s.content_hash AND a.version_stamp = s.version_stamp;
--
-- down:
--   DROP INDEX IF EXISTS idx_niete_lp_asset_sources_lesson;
--   -- destructive: reviewed — the rollback of V1.5.2 drops only the table this file
--   -- created, and nothing reads it until LP_QUIZ_OFFER_ENABLED is on.
--   DROP TABLE IF EXISTS niete_lp_asset_sources;
