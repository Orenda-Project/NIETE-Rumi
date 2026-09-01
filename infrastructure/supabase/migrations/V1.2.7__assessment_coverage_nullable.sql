-- V1.2.7 — page_ranges was NOT NULL on a promise the code could not keep.
--
-- V1.2.6 declared `page_ranges TEXT NOT NULL` on the reasoning that a chapter
-- is resolved to pages before the request is stored. The resolution was never
-- written, so every request made by picking a CHAPTER — the common path, and
-- the default one — failed on 23502 and produced no row and no job. The
-- teacher saw a terminal screen that apologised and promised delivery in the
-- same breath.
--
-- The resolution now exists. This migration stops the column asserting more
-- than the data can support: a chapter whose contents page carries no page
-- numbers is real, and its request is still a request. What must hold is that
-- SOMETHING says what to cover — which is a CHECK, not a NOT NULL.

ALTER TABLE assessment_requests
  ALTER COLUMN page_ranges DROP NOT NULL;

-- Exactly the invariant that is true: she chose a chapter, or she typed pages,
-- or both (a chapter we resolved). Never neither.
ALTER TABLE assessment_requests
  DROP CONSTRAINT IF EXISTS assessment_requests_has_coverage;
ALTER TABLE assessment_requests
  ADD CONSTRAINT assessment_requests_has_coverage
  CHECK (chapter_number IS NOT NULL OR page_ranges IS NOT NULL);

COMMENT ON COLUMN assessment_requests.page_ranges IS
  'The pages covered. Filled from her typed input, or resolved from the chapter '
  'she picked. Null only when she picked a chapter whose contents page carries '
  'no page numbers.';

NOTIFY pgrst, 'reload schema';
