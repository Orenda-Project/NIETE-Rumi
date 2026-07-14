-- Multi-source lesson-plan catalog (Oxbridge, Taleemabad, NBF, Beaconhouse, …)
-- ingested from external partners into the NIETE-Rumi Supabase.
--
-- First producer: `scripts/migrate-lesson-plans.py` — imports Oxbridge LPs from
-- Taleemabad's `fde_production.lesson_plan_externallessonplan` (70 rows across
-- grades 6–12, subjects Biology/Chemistry/CS/General Science/Physics).
--
-- Design notes:
--   * `(source, source_row_id)` is the idempotency key. Re-runs UPSERT.
--   * grade/subject/chapter_title are RESOLVED strings, not FKs — the source
--     taxonomy (`slo_gradesubject` → `slo_grade`+`slo_subject`) does not have
--     a stable counterpart in NIETE-Rumi and denormalising keeps the catalog
--     self-contained + queryable without a join tree.
--   * `content_html` is the raw LP body (HTML text — no PDFs, verified against
--     the source).
--   * Style mirrors training_* tables: BIGSERIAL PK, `is_active` boolean,
--     TIMESTAMPTZ timestamps, `source_*` provenance columns for the origin
--     row.

CREATE TABLE IF NOT EXISTS lesson_plan_catalog (
    id                   BIGSERIAL PRIMARY KEY,
    source               VARCHAR(32) NOT NULL,            -- 'oxbridge', 'taleemabad', 'nbf', 'beaconhouse', ...
    source_row_id        BIGINT NOT NULL,                 -- origin table primary key (for idempotent re-runs)
    source_uuid          UUID,                            -- origin table uuid column, if present
    grade                TEXT,                            -- resolved: e.g. 'Grade Six'
    subject              TEXT,                            -- resolved: e.g. 'Biology'
    chapter_title        TEXT,                            -- resolved via chapter FK (nullable)
    content_html         TEXT,                            -- LP body (HTML)
    description          TEXT,
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    source_created_at    TIMESTAMPTZ,                     -- preserved from origin `created` column
    source_modified_at   TIMESTAMPTZ,                     -- preserved from origin `modified` column
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, source_row_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_plan_catalog_source ON lesson_plan_catalog(source) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_lesson_plan_catalog_grade_subject ON lesson_plan_catalog(grade, subject) WHERE is_active;

NOTIFY pgrst, 'reload schema';
