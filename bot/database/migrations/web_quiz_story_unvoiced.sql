-- requires: web_quiz_stories.sql
-- Migration: a storybook page a child opened before it had a voice gets its own event name, story_page_unvoiced.
-- Until now such a page was logged as story_page_listened with data {miss:true}, and every reader of "pages listened"
-- had to remember to skip it. The voicing backlog (story-load.js missedPages) reads both shapes, so this applies
-- before or after the book API starts writing the new name.
--
-- WIDENS ONE CHECK. story_events.event keeps its six names and gains story_page_unvoiced; no row changes. Applied twice,
-- the second run changes nothing. Rollback: web_quiz_story_unvoiced_rollback.sql.
-- Mirrored in infrastructure/supabase/00_complete-schema.sql.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_events_event_check' AND conrelid = 'public.story_events'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%story_page_unvoiced%') THEN
    ALTER TABLE public.story_events DROP CONSTRAINT IF EXISTS story_events_event_check;
    ALTER TABLE public.story_events ADD CONSTRAINT story_events_event_check
      CHECK (event IN ('story_opened', 'story_page_listened', 'story_page_read', 'story_questions_done', 'story_done', 'story_shared', 'story_page_unvoiced'));
  END IF;
END $$;
