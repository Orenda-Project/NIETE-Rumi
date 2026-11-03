-- Migration rollback for coach_feedback_voice.sql (bd-x1tl95).
-- destructive: reviewed. Drops the voice message, transcript, screenshot, context and notified_at columns, and deletes
-- every report that was only a voice message (it has no words, so it cannot meet message NOT NULL again). The files in
-- R2 stay. Export those rows first if any were sent.

ALTER TABLE public.coach_feedback DROP CONSTRAINT IF EXISTS coach_feedback_says_something;
ALTER TABLE public.coach_feedback DROP CONSTRAINT IF EXISTS coach_feedback_photo_keys_max;
-- destructive: reviewed
ALTER TABLE public.coach_feedback DROP COLUMN IF EXISTS audio_key;
-- destructive: reviewed
ALTER TABLE public.coach_feedback DROP COLUMN IF EXISTS audio_transcript;
-- destructive: reviewed
ALTER TABLE public.coach_feedback DROP COLUMN IF EXISTS photo_keys;
-- destructive: reviewed
ALTER TABLE public.coach_feedback DROP COLUMN IF EXISTS context;
-- destructive: reviewed
ALTER TABLE public.coach_feedback DROP COLUMN IF EXISTS notified_at;
-- destructive: reviewed
DELETE FROM public.coach_feedback WHERE message IS NULL;
ALTER TABLE public.coach_feedback ALTER COLUMN message SET NOT NULL;
NOTIFY pgrst, 'reload schema';
