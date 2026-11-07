-- requires: 017_lp_feedback.sql
-- Assessment survey: "Was this paper useful?" and "How can we make it better?" are stored on
-- lp_feedback, one row per teacher per paper. The row carries the paper instead of a lesson.
-- Mirrors infrastructure/supabase/migrations/V1.9.4__assessment_teacher_feedback.sql.
--
-- Safe to re-run.

ALTER TABLE lp_feedback ADD COLUMN IF NOT EXISTS assessment_paper_id UUID REFERENCES assessment_papers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lp_feedback_assessment_paper
  ON lp_feedback (assessment_paper_id) WHERE assessment_paper_id IS NOT NULL;

COMMENT ON COLUMN lp_feedback.assessment_paper_id IS
  'The assessment paper this survey row rates. NULL on every lesson-plan row.';
