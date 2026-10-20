-- Migration: teacher reminder opt-outs (a teacher replied STOP to the quiz reminder template).
--
-- NON-DESTRUCTIVE. One new table; nothing existing is touched.
-- Owner: notify-org. Steward: the NIETE bot team. Read and written by the bot's service role only (RLS on, no policy).
--
--   teacher_reminder_optouts  one row per teacher per reminder kind the teacher stopped. Written by
--                             bot/shared/services/nudges/reminder-stop.js (source 'stop_reply'); read by
--                             window-closed-template.js before every send, dry run included: a row = never sent again.
--
-- Retention: kept while the user exists; deleted with the user (ON DELETE CASCADE). No phone, no message text.
-- Every statement is IF NOT EXISTS: applying it twice is a no-op.
-- Rollback: teacher_reminder_optouts_rollback.sql.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS public.teacher_reminder_optouts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind          text        NOT NULL CHECK (kind IN ('quiz_reminder_template')),
  opted_out_at  timestamptz NOT NULL DEFAULT now(),
  source        text        NOT NULL CHECK (source IN ('stop_reply')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_reminder_optouts_one_per_kind UNIQUE (user_id, kind)
);
COMMENT ON TABLE public.teacher_reminder_optouts IS 'Teachers who replied STOP to a reminder template; a row = that reminder kind is never sent to them again. Owner notify-org; steward the NIETE bot team. Service role only.';
COMMENT ON COLUMN public.teacher_reminder_optouts.user_id IS 'PII: the teacher (users.id) who opted out';
COMMENT ON COLUMN public.teacher_reminder_optouts.kind IS 'Which reminder the teacher stopped: quiz_reminder_template (teacher_quiz_reminder_v1)';
COMMENT ON COLUMN public.teacher_reminder_optouts.source IS 'How the opt-out arrived: stop_reply (STOP or «روکیں» after the template)';
ALTER TABLE public.teacher_reminder_optouts ENABLE ROW LEVEL SECURITY;   -- no policy: service role only
