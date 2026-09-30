-- V1.5.6 — assessment paper versions: ONE column, not a table.
-- Versioned migration in infrastructure/supabase/migrations (applied per environment, in order).
--
-- WHY. After a paper is made on WhatsApp a teacher edits it, repeatedly, and may
-- edit ANY version (operator, 30 Sep 2026). Until now the one row was rewritten in
-- place (the edit path overwrote exam_json and file_r2_key), so the paper as
-- generated was lost and "go back to the paper as generated" was impossible.
--
-- WHY NOT A TABLE (checked against the live schema, 30 Sep 2026):
--   * a version is exactly the thing a paper row already is — a tree, a file, a
--     key, counts, status. A versions table would duplicate every column.
--   * request_id already groups a family (idx_assessment_papers_request) and a
--     version keeps its parent's request_id, so "all versions of this paper" is
--     an indexed equality. The version NUMBER is derived, never stored.
--   * edited_from names the version it was branched from, which a sibling ordering
--     cannot express (v4 may be branched from v2).
--
-- UNIQUE(request_id, attempt) is narrowed to generated rows: a version inherits
-- its parent's attempt. Live: attempt > 1 = 0 rows, so nothing changes for rows
-- that exist today.
--
-- DATA. No teacher data: ids only. Classification: internal.
-- LOAD. ~500 edited papers today; one child row per "Make my paper".
-- IDEMPOTENT. Re-running adds nothing. Reverse: ROLLBACK_V1.5.6__assessment_paper_versions.sql
-- ORDER. Apply BEFORE the code that selects edited_from (PostgREST rejects the
-- whole query for an unknown column).

BEGIN;

ALTER TABLE assessment_papers
  ADD COLUMN IF NOT EXISTS edited_from UUID REFERENCES assessment_papers(id);

ALTER TABLE assessment_papers
  DROP CONSTRAINT IF EXISTS assessment_papers_edited_from_not_self;
ALTER TABLE assessment_papers
  ADD CONSTRAINT assessment_papers_edited_from_not_self
  CHECK (edited_from IS NULL OR edited_from <> id);

-- The old UNIQUE(request_id, attempt), found by definition rather than by a
-- guessed name.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'assessment_papers'::regclass AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (request_id, attempt)';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE assessment_papers DROP CONSTRAINT %I', c);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_papers_request_attempt_generated
  ON assessment_papers (request_id, attempt) WHERE edited_from IS NULL;

-- The foreign key's index, partial: most rows are roots.
CREATE INDEX IF NOT EXISTS idx_assessment_papers_edited_from
  ON assessment_papers (edited_from) WHERE edited_from IS NOT NULL;

COMMENT ON COLUMN assessment_papers.edited_from IS
  'Internal. The version this one was edited from (NULL = generated, i.e. version 1). '
  'A version keeps its parent''s request_id and attempt. exam_json of a ready row is '
  'never rewritten; removed questions stay in it flagged "removed": true.';

INSERT INTO app_settings (key, value, description)
VALUES ('assessment_versions_enabled', 'false'::jsonb,
        'Assessment cutover: Edit button on the paper, a question list with removed ones marked, '
        'every Make my paper is a new version. Flip ONLY together with the review Flow publish. '
        'Transitional — deleted at cleanup.')
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
