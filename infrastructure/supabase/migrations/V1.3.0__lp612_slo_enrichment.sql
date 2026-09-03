-- ---------------------------------------------------------------------------
-- V1.3.0 — the deterministic SLO/section enrichment on the 6-12 menu rows.
--
-- A pass over the finished corpus fills these for all 5,482 segments at 100%
-- coverage. They are the curriculum spine the authoring brief quotes from: a
-- segment that reaches the author without them produces a lesson with no stated
-- learning outcome to teach to, which is the one thing an FBISE-aligned plan
-- cannot be missing.
--
-- Native arrays rather than JSONB, matching this table's own convention for
-- pages_covered (INTEGER[]) and revision_source_segments (TEXT[]) — one array
-- style per table, and these are read as lists and never queried by key.
--
-- NOT NULL DEFAULT '{}' for the same reason those two are: a null array reaching
-- a chunked upsert fails the whole 250-row chunk rather than the one row, and
-- the importer's own coercion is the belt to this braces.
--
-- `section` and `section_ref` are BOTH kept and are not duplicates: `section` is
-- the human label and is present for every segment; `section_ref` is the printed
-- section number and is null for ~68% of the corpus, because most chapters do
-- not print one. The ref is what a teacher matches against her book, so it stays
-- nullable rather than being back-filled with a sentinel.
--
-- Anti-sprawl (Rule 15): 4 columns on a table this feature already owns, 0 new
-- tables. None of them is derivable — this is authored curriculum metadata, so
-- there is nothing to compute it from.
-- ---------------------------------------------------------------------------

ALTER TABLE niete_lp612_segments
  ADD COLUMN IF NOT EXISTS slo_codes         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS slo_descriptions  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS slo_source        TEXT,
  ADD COLUMN IF NOT EXISTS section           TEXT;

COMMENT ON COLUMN niete_lp612_segments.slo_codes IS
  'Curriculum SLO codes for this teaching day (e.g. B-10-C01-01). From the deterministic enrichment pass; 100% coverage.';
COMMENT ON COLUMN niete_lp612_segments.slo_descriptions IS
  'Human-readable SLO descriptions, parallel to slo_codes.';
COMMENT ON COLUMN niete_lp612_segments.slo_source IS
  'Provenance of the SLOs — house_minted where no official FBISE scheme of studies exists to cite.';
COMMENT ON COLUMN niete_lp612_segments.section IS
  'The human section label, present for every segment. section_ref holds the PRINTED section number and is null for most of the corpus.';
