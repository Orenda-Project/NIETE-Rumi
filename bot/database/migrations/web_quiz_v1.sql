-- Migration: the web child quiz (children play the class quiz on a web page).
--
-- NON-DESTRUCTIVE. One new nullable column and one relaxed constraint.
--
--   device_ref   a server-random per-browser id, minted by the web quiz API.
--                NULL = a WhatsApp session. Needed for "the first finished
--                attempt counts" across phones and for the report's
--                "played on 2 phones" line. No existing column holds it:
--                user_id is the teacher self-test marker, parent_phone is a
--                phone.
--   parent_phone DROP NOT NULL — a web session has no phone. A NULL is chosen
--                over a sentinel because the class-card sender already skips
--                a missing phone (video-quiz-report.service.js, 'no_phone');
--                a sentinel string would be handed to the WhatsApp sender.
--
-- No new table, no new source value: a web join is a share_link session; the
-- channel is `device_ref IS NOT NULL`.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS device_ref text;
ALTER TABLE public.quiz_sessions ALTER COLUMN parent_phone DROP NOT NULL;
COMMENT ON COLUMN public.quiz_sessions.device_ref IS
  'web quiz: server-random per-browser id; never a phone. NULL = WhatsApp session';
