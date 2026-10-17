-- requires: create_student_videos_table.sql
-- Migration: a video lesson's name, and its chapter's, in Urdu script, beside today's clean_title / clean_chapter (which
-- are written in Roman letters), so an Urdu child's Videos door can print Urdu letters.
--
-- NON-DESTRUCTIVE. Two nullable columns; nothing existing reads them and nothing existing changes. Filled for the Urdu
-- lessons from a native-read list (one guarded UPDATE per row); read by the video library only under app_settings
-- web_quiz_videos_ur_titles. NULL = no Urdu name: the door keeps today's title.
-- Mirrored in infrastructure/supabase/00_complete-schema.sql.
ALTER TABLE student_videos ADD COLUMN IF NOT EXISTS title_ur text;
ALTER TABLE student_videos ADD COLUMN IF NOT EXISTS chapter_ur text;
