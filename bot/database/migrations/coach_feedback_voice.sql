-- requires: coach_feedback.sql
-- Migration: coach_feedback takes a voice message and screenshots — "Send feedback" on the coach's More (bd-x1tl95).
--
-- ONE FORM, ONE TABLE. Report an issue (bd-whlsm0, coach_feedback.sql) and Send feedback (bd-x1tl95) were asked for on
-- the same day for the same place; they ship as one form, Send feedback, writing this table. Its four kinds stay.
-- Written by the bot (bot/shared/services/feedback/app-feedback.service.js) when the portal relays a send; the
-- transcript and notified_at (the team's Slack post went out) are filled in by the same service afterwards.
--
-- NON-DESTRUCTIVE. Five new columns, message may now be NULL when she only spoke (never both empty), at most three
-- screenshots. Apply sandbox first; staging and prod on a go. Idempotent. No BEGIN/COMMIT (exec_sql refuses it).
-- Rollback: coach_feedback_voice_rollback.sql.
--
-- Owner: NIETE portal team. Steward: Hataf Atif.
-- Sensitivity (D6): audio_key PII (her voice); audio_transcript and photo_keys Confidential (may name a teacher or a
-- school); context and notified_at Internal. No column holds a phone number.

ALTER TABLE public.coach_feedback ALTER COLUMN message DROP NOT NULL;
ALTER TABLE public.coach_feedback ADD COLUMN IF NOT EXISTS audio_key text;
ALTER TABLE public.coach_feedback ADD COLUMN IF NOT EXISTS audio_transcript text;
ALTER TABLE public.coach_feedback ADD COLUMN IF NOT EXISTS photo_keys text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.coach_feedback ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.coach_feedback ADD COLUMN IF NOT EXISTS notified_at timestamptz;

ALTER TABLE public.coach_feedback DROP CONSTRAINT IF EXISTS coach_feedback_says_something;
ALTER TABLE public.coach_feedback ADD CONSTRAINT coach_feedback_says_something CHECK (message IS NOT NULL OR audio_key IS NOT NULL);
ALTER TABLE public.coach_feedback DROP CONSTRAINT IF EXISTS coach_feedback_photo_keys_max;
ALTER TABLE public.coach_feedback ADD CONSTRAINT coach_feedback_photo_keys_max CHECK (cardinality(photo_keys) <= 3);

COMMENT ON TABLE public.coach_feedback IS
  'A coach''s feedback from the portal (More → Send feedback; Report an issue, bd-whlsm0, folded in by bd-x1tl95): a kind, her words and/or a voice message, up to three screenshots. Owner: NIETE portal team; steward: Hataf Atif. Written only by the server for the session coach.';
COMMENT ON COLUMN public.coach_feedback.message IS '[Confidential] what she wrote, trimmed, 1-2000 characters; NULL when she only spoke; free text that may name people; never logged';
COMMENT ON COLUMN public.coach_feedback.audio_key IS '[PII] R2 key of her voice message (feedback_audio/<user>/<YYYY-MM>/portal_<id>)';
COMMENT ON COLUMN public.coach_feedback.audio_transcript IS '[Confidential] the voice message as text; NULL until transcribed, or when it could not be';
COMMENT ON COLUMN public.coach_feedback.photo_keys IS '[Confidential] R2 keys of her screenshots (feedback_images/<user>/portal_<id>), at most 3';
COMMENT ON COLUMN public.coach_feedback.context IS '[Internal] where it was sent from: browser class, app build. No user agent, no phone';
COMMENT ON COLUMN public.coach_feedback.notified_at IS '[Internal] when the team''s Slack post went out (UTC); NULL = not posted';

NOTIFY pgrst, 'reload schema';
