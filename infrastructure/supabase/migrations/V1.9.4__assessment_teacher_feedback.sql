-- V1.9.4 — the assessment survey's paper id on lp_feedback.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. Teachers are now asked about each assessment paper ("Was this paper useful?" then "How can we make the
-- paper or the experience better?"), 30s after the paper and its key reach WhatsApp. The answers go on the
-- existing lp_feedback table (schema-first, no new table), as the 6-12 survey's did in V1.3.5: this adds the one
-- identity column that lane needs. lp_variant = 'assessment_en' | 'assessment_ur' is the lane discriminator;
-- grade / subject / chapter_number are snapshotted from the request, so a query needs no join.
--
-- DATA CLASSIFICATION (D6): '[Internal]' — a paper id. The row's teacher-written text already lives in
-- lp_feedback.reason_text, classified with that table.
-- OWNER (D7): NIETE-Rumi platform.
-- DATA. New nullable column, NULL on every existing row. LOAD. One row per teacher per paper.
-- SECURITY. Unchanged: lp_feedback is server-only.
-- IDEMPOTENT. IF NOT EXISTS throughout.
-- Rollback: ROLLBACK_V1.9.4__assessment_teacher_feedback.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE lp_feedback ADD COLUMN IF NOT EXISTS assessment_paper_id UUID REFERENCES assessment_papers(id) ON DELETE SET NULL;

COMMENT ON COLUMN lp_feedback.assessment_paper_id IS
  'The assessment paper this verdict is about (assessment_papers.id). NULL for every lesson-plan row. Set '
  'together with lp_variant = ''assessment_en'' | ''assessment_ur'', the lane + language discriminator.';

CREATE INDEX IF NOT EXISTS idx_lp_feedback_assessment_paper
  ON lp_feedback (assessment_paper_id, created_at DESC)
  WHERE assessment_paper_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
