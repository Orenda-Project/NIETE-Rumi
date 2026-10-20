-- ROLLBACK V1.7.1 — video_recommendations retrieval route columns (reverses migration V1.7.1).
-- destructive: reviewed — drops only the three columns V1.7.1 added and restores the V1.7.0 first-only index;
-- the V1.7.0 tables stay. If two devices clicked one link meanwhile, the restored index fails on the duplicate
-- click rows: delete all but the first click per (recommendation_id, surface, ua_class) before running this.
BEGIN;
DROP INDEX IF EXISTS uq_video_reco_events_click_device;
DROP INDEX IF EXISTS uq_video_reco_events_first;
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_reco_events_first
  ON video_reco_events (recommendation_id, event, COALESCE(surface, 'wa'), COALESCE(ua_class, '-')) WHERE event <> 'error';
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS step_text_query;
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS tag_mismatch;
ALTER TABLE video_recommendations DROP COLUMN IF EXISTS route;
COMMIT;
NOTIFY pgrst, 'reload schema';
