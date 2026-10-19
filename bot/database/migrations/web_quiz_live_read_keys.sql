-- requires: web_quiz_challenge.sql
-- Migration: live reading v3 (switch web_quiz_live_read_v3, OFF on every tier): one row per story-page speech key.
--
-- NON-DESTRUCTIVE. One new table; nothing existing changes.
--
-- Why a table: a story page asks the bot for a one-read temporary speech key. The child's day cap
-- (app_settings web_quiz_live_read_story_keys_per_day, default 40) and the whole day's read budget
-- (web_quiz_challenge_daily_reads, counted by web-quiz-challenge-budget.js) must hold across restarts and replicas, so
-- each key is counted here, not in a process's memory. A story page keeps no voice and no run row: this row says who
-- and when, and nothing else — never a transcript, a book's text, a word count or a score.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS public.web_quiz_live_read_keys (
  id          uuid PRIMARY KEY,
  student_id  uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  src         text NOT NULL DEFAULT 'story_page' CHECK (src IN ('story_page')),
  lang        text CHECK (lang IN ('en', 'ur')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_quiz_live_read_keys_student_idx
  ON public.web_quiz_live_read_keys (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS web_quiz_live_read_keys_created_idx
  ON public.web_quiz_live_read_keys (created_at);

ALTER TABLE public.web_quiz_live_read_keys ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.web_quiz_live_read_keys IS
  'live reading v3: one row per story-page speech key (who, when, language) for the day caps; written only by the bot (service role)';
