-- ROLLBACK V1.7.1 — video_recommendations retrieval route columns (reverses migration V1.7.1).
-- destructive: reviewed — drops only the three columns V1.7.1 added; the V1.7.0 tables stay.
BEGIN;
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS step_text_query;
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS tag_mismatch;
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS route;
COMMIT;
NOTIFY pgrst, 'reload schema';
