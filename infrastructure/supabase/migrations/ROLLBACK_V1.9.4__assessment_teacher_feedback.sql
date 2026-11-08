-- ROLLBACK_V1.9.4 — reverse of V1.9.4 assessment survey column, Flyway-style rollback applied by migrate.js.
-- destructive: reviewed — drops lp_feedback.assessment_paper_id. The rows stay (their verdict and idea text are
-- kept); they lose which paper they were about. Roll the code back first: the survey writes this column.
-- NO BEGIN/COMMIT: migrate.js runs the file as one exec_sql call.

DROP INDEX IF EXISTS idx_lp_feedback_assessment_paper;
-- destructive: reviewed (see header)
ALTER TABLE lp_feedback DROP COLUMN IF EXISTS assessment_paper_id;

NOTIFY pgrst, 'reload schema';
