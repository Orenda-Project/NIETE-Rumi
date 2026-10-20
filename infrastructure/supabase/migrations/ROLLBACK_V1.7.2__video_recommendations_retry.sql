-- ROLLBACK V1.7.2 (bd-gzfdu9): removes the retry and language columns; the v1.3 engine never reads them.
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS chapter_language;
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS lesson_language;
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS report_language_null;
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS first_none_reason;
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS attempts;

NOTIFY pgrst, 'reload schema';
