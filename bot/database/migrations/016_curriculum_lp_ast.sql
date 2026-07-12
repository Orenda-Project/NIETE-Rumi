-- 016_curriculum_lp_ast.sql
--
-- Curriculum LP AST — a per-lesson-plan Abstract Syntax Tree table that stores
-- the structured content of NBF + Taleemabad lesson plans imported from
-- taleemabad-core (Taleemabad prod Postgres, fde_production schema).
--
-- Framing: the JSON step arrays (opening/practice/explain/…) are a
-- "pre-render" of the LP — finished content, presentation deferred to
-- serve time. The bot renders on demand into WhatsApp messages OR a
-- cached PDF (pdf_r2_key_* below) depending on how the LP is requested.
--
-- Source pipeline:
--   Taleemabad prod ── import-tbcore-lps.js ──> curriculum_lp_ast (this table)
--                                                       │
--                                                       └──> renderer (later) ──> R2 PDF cache
--
-- Uniqueness:
--   source_lp_uuid  (round-trip key back into taleemabad-core.slo_lessonplan.uuid)
--   (curriculum_key, grade, subject, chapter_number, lp_index) — natural key for lookup
--
-- Idempotent re-imports use source_hash to skip unchanged rows.

CREATE TABLE IF NOT EXISTS curriculum_lp_ast (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Traceability back to taleemabad-core (for round-trip / diffing / re-imports).
  -- source_lp_uuid is NOT unique on its own — a single LP can be linked to
  -- multiple chapters (e.g. one "Introductory LP" attached to Grades 1-5).
  -- The natural key mirrors the source's UNIQUE (book_chapter_id, lesson_plan_id).
  source_lp_uuid                UUID NOT NULL,
  source_book_id                BIGINT NOT NULL,
  source_chapter_id             BIGINT NOT NULL,
  source_join_id                BIGINT NOT NULL,

  -- Publisher + curriculum classification
  publisher                     TEXT NOT NULL CHECK (publisher IN ('NBF','Taleemabad')),
  curriculum_key                TEXT NOT NULL,   -- 'nbf_snc' | 'taleemabad'

  -- Grade: INT (Prep=0, Grade One=1, …, Grade Five=5). grade_label preserved for UX.
  grade                         INT NOT NULL,
  grade_label                   TEXT NOT NULL,

  -- Subject: lowercased_underscore slug + original label.
  subject                       TEXT NOT NULL,
  subject_label                 TEXT NOT NULL,

  -- Chapter + position within chapter
  chapter_number                INT NOT NULL,
  chapter_title                 TEXT NOT NULL,
  lp_index                      INT NOT NULL,

  -- LP metadata
  topic                         TEXT NOT NULL,
  lp_type                       TEXT,
  lp_source                     TEXT,             -- 'retool' | 'gen-ai'
  lp_category                   TEXT,             -- 'hyper-specific' | 'generic'

  -- The pre-render itself — untouched JSON step arrays from source
  opening_steps                 JSONB NOT NULL,
  practice_steps                JSONB NOT NULL,
  explain_steps                 JSONB NOT NULL,
  independent_practice_steps    JSONB,
  conclusion_steps              JSONB,
  classroom_setup_instructions  JSONB,
  homework_instructions         JSONB,

  -- Media + SLO references
  videos                        TEXT[] NOT NULL DEFAULT '{}',
  lp_slo                        TEXT[] NOT NULL DEFAULT '{}',
  contains_video                BOOLEAN NOT NULL DEFAULT false,

  -- Timing (minutes per stage)
  opening_time                  INT,
  explain_time                  INT,
  practice_time                 INT,
  independent_practice_time     INT,
  conclusion_time               INT,

  -- Rendering cache — populated by the renderer, not by this import
  pdf_r2_key_en                 TEXT,
  pdf_r2_key_ur                 TEXT,
  rendered_at                   TIMESTAMPTZ,

  -- Enablement (NIETE-Rumi's own flag, independent of the source system)
  is_enabled                    BOOLEAN NOT NULL DEFAULT true,

  -- Housekeeping
  source_hash                   TEXT NOT NULL,
  imported_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Natural key mirroring the source's UNIQUE (book_chapter_id, lesson_plan_id).
  -- lp_index is NOT part of the natural key: two LPs can share the same lp_index
  -- position within a chapter in the source data.
  UNIQUE (source_chapter_id, source_lp_uuid)
);

-- Lookup path by lp_uuid (non-unique — an LP can be linked to multiple chapters)
CREATE INDEX IF NOT EXISTS idx_curriculum_lp_ast_source_lp_uuid
  ON curriculum_lp_ast (source_lp_uuid);

-- Direct lookup path: (curriculum, grade, subject, chapter_number) for the intercept
CREATE INDEX IF NOT EXISTS idx_curriculum_lp_ast_lookup
  ON curriculum_lp_ast (curriculum_key, grade, subject, chapter_number)
  WHERE is_enabled = true;

-- Topic full-text search — complements the existing bidirectional substring match
CREATE INDEX IF NOT EXISTS idx_curriculum_lp_ast_topic_fts
  ON curriculum_lp_ast USING GIN (to_tsvector('english', topic));

-- Publisher slice — for the "what's in the catalog" queries
CREATE INDEX IF NOT EXISTS idx_curriculum_lp_ast_publisher
  ON curriculum_lp_ast (publisher, is_enabled);

COMMENT ON TABLE curriculum_lp_ast IS
  'Pre-rendered LP corpus: JSON step arrays imported from taleemabad-core (NBF + Taleemabad publishers). See docs/migration/01-lesson-plans.md.';

COMMENT ON COLUMN curriculum_lp_ast.source_lp_uuid IS
  'slo_lessonplan.uuid in taleemabad-core. Round-trip key for re-imports; unique.';

COMMENT ON COLUMN curriculum_lp_ast.source_hash IS
  'SHA-256 of the source row payload. Re-imports skip rows where source_hash is unchanged (idempotency).';

COMMENT ON COLUMN curriculum_lp_ast.grade IS
  'Prep=0, Grade One=1, ..., Grade Five=5. See grade_label for the human-readable form.';

COMMENT ON COLUMN curriculum_lp_ast.pdf_r2_key_en IS
  'Set by the LP renderer, not by this import. NULL until a PDF has been rendered and cached in R2.';
