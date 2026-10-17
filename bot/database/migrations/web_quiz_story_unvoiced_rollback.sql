-- Rollback of web_quiz_story_unvoiced.sql: each story_page_unvoiced row becomes the story_page_listened {miss:true}
-- row it replaced (so the voicing backlog still finds it), then the check is the six names again.
UPDATE public.story_events SET event = 'story_page_listened', data = data || '{"miss": true}'::jsonb WHERE event = 'story_page_unvoiced';
DO $$
DECLARE c record;
BEGIN
  -- Every check on the event names goes, whatever name the database gave it (the same lookup as the migration), so no
  -- seven-name check is left beside the six-name one. Applied twice, the second run ends the same.
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.story_events'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%story_opened%' LOOP
    EXECUTE format('ALTER TABLE public.story_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.story_events ADD CONSTRAINT story_events_event_check
    CHECK (event IN ('story_opened', 'story_page_listened', 'story_page_read', 'story_questions_done', 'story_done', 'story_shared'));
END $$;
