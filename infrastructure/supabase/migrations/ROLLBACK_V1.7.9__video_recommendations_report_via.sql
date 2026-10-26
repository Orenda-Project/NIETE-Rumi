-- ROLLBACK V1.7.9 (bd-gzfdu9 R7p-b): removes report_via; the writer probes the column and then sends no report_via key.
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS report_via;

NOTIFY pgrst, 'reload schema';
