-- requires: (none; users exists)
-- Migration: whatsapp_feedback — /feedback and /bug sent to the bot on WhatsApp.
--
-- NON-DESTRUCTIVE. One new table; nothing existing changes shape. Apply to sandbox first; staging and prod only on a
-- go, and only before WHATSAPP_FEEDBACK is switched on there. Rollback: whatsapp_feedback_rollback.sql.
--
-- Written by bot/shared/services/feedback/whatsapp-feedback-intake.service.js for the registered sender only, one row
-- per report. A table of its own, not coach_feedback (the portal's form): the operator asked for the WhatsApp reports
-- to be kept apart. Read by a watcher outside the app that tells the operator about new rows; nothing in the app
-- reads it. Append-only: rows are never updated by the app and never deleted (updated_at is kept for D5).
--
-- Owner: NIETE bot team. Steward: Hataf Atif.
-- Sensitivity (D6): id, ref, role, command, topic, language, wa_message_id, created_at, updated_at Internal;
-- user_id Confidential (links to a person); message and transcript Confidential (free text that may name a teacher
-- or a school; never logged); audio_key PII (her voice).

CREATE TABLE IF NOT EXISTS public.whatsapp_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            text NOT NULL UNIQUE CHECK (ref ~ '^NF-[A-HJKMNP-Z2-9]{5}$'),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role           text CHECK (role IS NULL OR char_length(role) BETWEEN 1 AND 40),
  command        text NOT NULL CHECK (command IN ('feedback', 'bug')),
  topic          text NOT NULL CHECK (topic IN ('broken', 'idea', 'other')),
  message        text CHECK (message IS NULL OR char_length(btrim(message)) BETWEEN 1 AND 2000),
  audio_key      text CHECK (audio_key IS NULL OR (audio_key LIKE 'feedback_audio/%' AND char_length(audio_key) <= 300)),
  transcript     text CHECK (transcript IS NULL OR char_length(transcript) <= 8000),
  language       text CHECK (language IS NULL OR language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  wa_message_id  text UNIQUE CHECK (wa_message_id IS NULL OR char_length(wa_message_id) BETWEEN 1 AND 256),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_feedback_says_something CHECK (message IS NOT NULL OR audio_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS whatsapp_feedback_created_at_idx ON public.whatsapp_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_feedback_user_id_idx ON public.whatsapp_feedback (user_id);

COMMENT ON TABLE public.whatsapp_feedback IS
  'A report sent to the bot with /feedback or /bug on WhatsApp, one row each. Owner: NIETE bot team; steward: Hataf Atif. Written only by the bot for the registered sender; append-only.';
COMMENT ON COLUMN public.whatsapp_feedback.id IS '[Internal] the report';
COMMENT ON COLUMN public.whatsapp_feedback.ref IS '[Internal] the reference she is given back, NF- and five letters or digits; unique';
COMMENT ON COLUMN public.whatsapp_feedback.user_id IS '[Confidential] who sent it (users.id)';
COMMENT ON COLUMN public.whatsapp_feedback.role IS '[Internal] users.role when she sent it (teacher, coach, ...), so triage can tell them apart';
COMMENT ON COLUMN public.whatsapp_feedback.command IS '[Internal] feedback or bug: the command she used';
COMMENT ON COLUMN public.whatsapp_feedback.topic IS '[Internal] broken = something is not working; idea; other. /bug is always broken';
COMMENT ON COLUMN public.whatsapp_feedback.message IS '[Confidential] what she typed, trimmed, 1-2000 characters; NULL when she sent a voice note; never logged';
COMMENT ON COLUMN public.whatsapp_feedback.audio_key IS '[PII] R2 key of her voice note (feedback_audio/<user>/<YYYY-MM>/wa_<message id>.ogg)';
COMMENT ON COLUMN public.whatsapp_feedback.transcript IS '[Confidential] the voice note as text, made before the row was written; NULL for a typed report or when it could not be transcribed';
COMMENT ON COLUMN public.whatsapp_feedback.language IS '[Internal] the language she uses with the bot when she sent it (en or ur)';
COMMENT ON COLUMN public.whatsapp_feedback.wa_message_id IS '[Internal] the WhatsApp message id of the report; unique, so a redelivered webhook cannot make a second row';
COMMENT ON COLUMN public.whatsapp_feedback.created_at IS '[Internal] when she sent it (UTC)';
COMMENT ON COLUMN public.whatsapp_feedback.updated_at IS '[Internal] row last changed (UTC); set by trigger';
DROP TRIGGER IF EXISTS whatsapp_feedback_updated_at ON public.whatsapp_feedback;
CREATE TRIGGER whatsapp_feedback_updated_at BEFORE UPDATE ON public.whatsapp_feedback FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE public.whatsapp_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_whatsapp_feedback ON public.whatsapp_feedback;
CREATE POLICY service_role_whatsapp_feedback ON public.whatsapp_feedback FOR ALL USING (auth.role() = 'service_role');
GRANT ALL ON public.whatsapp_feedback TO service_role;

NOTIFY pgrst, 'reload schema';
