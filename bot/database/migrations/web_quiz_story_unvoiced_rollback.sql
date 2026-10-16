-- Rollback of web_quiz_story_unvoiced.sql: each story_page_unvoiced row becomes the story_page_listened {miss:true}
-- row it replaced (so the voicing backlog still finds it), then the check is the six names again.
UPDATE public.story_events SET event = 'story_page_listened', data = data || '{"miss": true}'::jsonb WHERE event = 'story_page_unvoiced';
ALTER TABLE public.story_events DROP CONSTRAINT IF EXISTS story_events_event_check;
ALTER TABLE public.story_events ADD CONSTRAINT story_events_event_check
  CHECK (event IN ('story_opened', 'story_page_listened', 'story_page_read', 'story_questions_done', 'story_done', 'story_shared'));
