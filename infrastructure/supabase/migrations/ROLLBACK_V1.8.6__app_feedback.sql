-- ROLLBACK V1.8.6 — app_feedback (reverses migration V1.8.6).
-- destructive: reviewed — drops only the table V1.8.6 created, with every feedback a coach sent. Export it first
-- (SELECT * FROM app_feedback) if any row has not been read. The R2 files under feedback_audio/ and feedback_images/
-- are not touched.
DROP TABLE IF EXISTS app_feedback;
NOTIFY pgrst, 'reload schema';
