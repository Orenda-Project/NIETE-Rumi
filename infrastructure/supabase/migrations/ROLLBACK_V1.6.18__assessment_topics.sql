-- Reverse of V1.6.18. Drops paper_kind from both tables, then the index and assessment_topics.
-- destructive: reviewed — loses every imported topic row (re-importable from the matrix) and the topic/pattern
-- labels on papers (they revert to being read as 'chapter').
-- SAFE ONLY after the code is rolled back: the generator selects paper_kind. Roll the CODE back first. Idempotent.
ALTER TABLE assessment_papers DROP COLUMN IF EXISTS paper_kind;
ALTER TABLE assessment_requests DROP COLUMN IF EXISTS paper_kind;
DROP INDEX IF EXISTS idx_assessment_topics_current;
DROP TABLE IF EXISTS assessment_topics;
NOTIFY pgrst, 'reload schema';
