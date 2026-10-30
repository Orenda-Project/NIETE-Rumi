-- V1.8.6 — app_feedback: "Send feedback" from the More page of the coach's app (bd-x1tl95). Versioned migration (D8),
-- applied per environment, in order, by infrastructure/scripts/migrate.js. Rollback: ROLLBACK_V1.8.6__app_feedback.sql.
--
-- WHAT. One row per send: a topic (problem / idea / other), her words and/or a voice message, up to three screenshots.
-- Written by the bot (bot/shared/services/feedback/app-feedback.service.js) when the portal relays a send; the voice
-- message's transcript and notified_at (the team's Slack post went out) are filled in afterwards by the same service.
-- Read by the team (a Slack post per send; a dashboard later). The files sit in R2 under feedback_audio/ and
-- feedback_images/; the row holds their keys.
--
-- WHY A NEW TABLE (schema-first, root rule 15). Checked against the schema on 30 Oct 2026: feature_suggestions is the
-- bot's own suggestion telemetry (shown / clicked / used), not something a person wrote; lp_feedback and
-- student_video_feedback are ratings of one lesson plan or video; coaching_quality_metrics is the report survey; and
-- coach_visit_requests is a request for a visit. None holds free text, a voice message and screenshots from a user to
-- the team.
--
-- DATA CLASSIFICATION (D6): every column carries COMMENT '[label] ...'. Her voice message is PII (audio_key points at
-- it); her words, the transcript and the screenshots may name a teacher or a school, so they are Confidential. No
-- column holds a phone number. user_id is Internal.
-- OWNER (D7): the NIETE portal team. STEWARD: the NIETE data steward named in the metadata registry.
-- LOAD. A handful of rows a day; the service refuses a person's 21st send in 24 hours.
-- IDEMPOTENT: IF NOT EXISTS / DROP ... IF EXISTS throughout. ORDER: safe before the code (nothing reads or writes it
-- until the portal's Send feedback row ships).

-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control.

CREATE TABLE IF NOT EXISTS app_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users (id),
  topic             TEXT NOT NULL CHECK (topic IN ('problem', 'idea', 'other')),
  message           TEXT CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 2000),
  audio_key         TEXT,
  audio_transcript  TEXT,
  photo_keys        TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_keys) <= 3),
  context           JSONB NOT NULL DEFAULT '{}'::jsonb,
  notified_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_feedback_says_something CHECK (message IS NOT NULL OR audio_key IS NOT NULL)
);

-- The service's 24-hour count per person, and the team's newest-first read.
CREATE INDEX IF NOT EXISTS idx_app_feedback_user_created ON app_feedback (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_app_feedback_created ON app_feedback (created_at DESC);

COMMENT ON TABLE app_feedback IS 'Send feedback from the app''s More page (bd-x1tl95): one row per send; a topic, her words and/or a voice message, up to three screenshots. Transcript and notified_at filled in after the send. Owner: NIETE portal team. Steward: the NIETE data steward named in the metadata registry.';
COMMENT ON COLUMN app_feedback.id IS '[Internal] row id (UUID v4)';
COMMENT ON COLUMN app_feedback.user_id IS '[Internal] who sent it (users.id)';
COMMENT ON COLUMN app_feedback.topic IS '[Internal] problem = something is not working, idea, other';
COMMENT ON COLUMN app_feedback.message IS '[Confidential] her own words, trimmed; NULL when she only spoke';
COMMENT ON COLUMN app_feedback.audio_key IS '[PII] R2 key of her voice message (feedback_audio/<user>/<YYYY-MM>/portal_<id>)';
COMMENT ON COLUMN app_feedback.audio_transcript IS '[Confidential] the voice message as text; NULL until transcribed, or when it could not be';
COMMENT ON COLUMN app_feedback.photo_keys IS '[Confidential] R2 keys of her screenshots (feedback_images/<user>/portal_<id>), at most 3';
COMMENT ON COLUMN app_feedback.context IS '[Internal] where it was sent from: surface, browser class, app build. No user agent, no phone';
COMMENT ON COLUMN app_feedback.notified_at IS '[Internal] when the team''s Slack post went out (UTC); NULL = not posted';
COMMENT ON COLUMN app_feedback.created_at IS '[Internal] row written (UTC)';
COMMENT ON COLUMN app_feedback.updated_at IS '[Internal] row last changed (UTC); set by trigger';

DROP TRIGGER IF EXISTS app_feedback_updated_at ON app_feedback;
CREATE TRIGGER app_feedback_updated_at BEFORE UPDATE ON app_feedback FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE app_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_app_feedback ON app_feedback;
CREATE POLICY service_role_app_feedback ON app_feedback FOR ALL USING (auth.role() = 'service_role');
GRANT ALL ON app_feedback TO service_role;

NOTIFY pgrst, 'reload schema';
