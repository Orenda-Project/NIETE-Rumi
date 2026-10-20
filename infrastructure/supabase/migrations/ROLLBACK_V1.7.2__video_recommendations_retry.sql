-- ROLLBACK V1.7.2 (bd-gzfdu9): removes the retry columns; the v1.3 engine never reads them.
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS first_none_reason;
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS attempts;

NOTIFY pgrst, 'reload schema';
