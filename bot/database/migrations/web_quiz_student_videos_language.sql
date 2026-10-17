-- requires: create_student_videos_table.sql
-- Migration: the language a video's lesson is in ('en' | 'ur'), stored on the video so a child's Videos shelf can
-- show one language without asking every video's quiz at tap time.
--
-- NON-DESTRUCTIVE. One nullable column; nothing existing reads it and nothing existing changes. Filled once by
-- scripts/web-quiz/backfill-video-language.js from the video's lesson quiz, by the rule the quiz's clips already use
-- (the quiz row's language, else its questions' script). NULL = not known yet.
-- Mirrored in infrastructure/supabase/00_complete-schema.sql.
ALTER TABLE student_videos ADD COLUMN IF NOT EXISTS language text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_videos_language_chk' AND conrelid = 'student_videos'::regclass) THEN
    ALTER TABLE student_videos ADD CONSTRAINT student_videos_language_chk CHECK (language IN ('en', 'ur'));
  END IF;
END $$;
