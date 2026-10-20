-- ROLLBACK V1.7.0 — video_recommendations + video_reco_events (reverses migration V1.7.0).
-- destructive: reviewed — drops only what V1.7.0 added: the two tables and their indexes.
-- Export both tables first if the A/B read (ab/analysis) has not yet been run against them.
BEGIN;
DROP TABLE IF EXISTS video_reco_events;
DROP TABLE IF EXISTS video_recommendations;
COMMIT;
NOTIFY pgrst, 'reload schema';
