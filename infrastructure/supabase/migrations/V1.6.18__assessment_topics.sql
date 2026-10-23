-- V1.6.18 — assessment_topics + paper_kind: "topic-wise" papers for the teacher assessment generator.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. assessment_topics holds the topics inside a chapter (one row per topic, with its pages, SLOs and teaching
-- days) as loaded by a later importer from the curriculum matrix. paper_kind says what a request/paper was built
-- from: a whole 'chapter' (every existing row), a 'topic', or a 'pattern'.
--
-- ACCESS. Mirrors niete_lp612_segments (V1.2.8), which has no RLS and no grants: the bot reads it with the
-- service role. Nothing is enabled here either.
--
-- DATA. Sensitivity: internal. Curriculum metadata only, no personal data.
-- IDEMPOTENT. IF NOT EXISTS throughout. Existing rows backfill to 'chapter' via the column default.
-- Rollback: ROLLBACK_V1.6.18__assessment_topics.sql
-- ORDER. Before the code: the generator selects paper_kind, and a select of a missing column fails.

CREATE TABLE IF NOT EXISTS assessment_topics (
  topic_id          TEXT PRIMARY KEY,
  grade             INTEGER,
  subject           TEXT,
  chapter_number    INTEGER,
  chapter_title     TEXT,
  name              TEXT,
  heading           TEXT,
  heading_order     INTEGER,
  sort_order        INTEGER,
  pages             INTEGER[],
  slo_codes         TEXT[],
  slo_descriptions  TEXT[],
  days              INTEGER[],
  is_current        BOOLEAN NOT NULL DEFAULT true,
  matrix_version    TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessment_topics_current
  ON assessment_topics (grade, subject, chapter_number)
  WHERE is_current;

ALTER TABLE assessment_requests
  ADD COLUMN IF NOT EXISTS paper_kind TEXT NOT NULL DEFAULT 'chapter'
  CHECK (paper_kind IN ('chapter', 'topic', 'pattern'));

ALTER TABLE assessment_papers
  ADD COLUMN IF NOT EXISTS paper_kind TEXT NOT NULL DEFAULT 'chapter'
  CHECK (paper_kind IN ('chapter', 'topic', 'pattern'));

NOTIFY pgrst, 'reload schema';
