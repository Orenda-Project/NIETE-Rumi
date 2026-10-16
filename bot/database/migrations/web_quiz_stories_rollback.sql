-- Rollback of web_quiz_stories.sql: drops the five storybook tables (nothing else references them; the files in
-- storage stay and are harmless without the rows).
DROP TABLE IF EXISTS public.story_events;
DROP TABLE IF EXISTS public.story_questions;
DROP TABLE IF EXISTS public.story_page_voices;
DROP TABLE IF EXISTS public.story_pages;
DROP TABLE IF EXISTS public.story_books;
