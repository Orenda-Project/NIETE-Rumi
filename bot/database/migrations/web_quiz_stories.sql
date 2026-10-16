-- Migration: storybooks for the web quiz child app — the books, their pages (picture, printed words and each word's
-- box on the picture), each page's voice with word timings, the questions after a book, and a small event log.
--
-- NON-DESTRUCTIVE. Five new tables and their indexes; nothing existing changes. Written only by the loader script
-- (scripts/web-quiz/load-stories.js, service role) and, for story_events, by the bot while app_settings
-- web_quiz_stories is on. Service role only (RLS on, no policy).
-- The tables below are mirrored byte for byte in infrastructure/supabase/00_complete-schema.sql.
--
--   story_books.source_id   the catalogue's stable id for the book (the same in every database)
--   story_books.status      draft (hidden from children) | ready (every quality gate passed) | off
--   story_books.questions_sprite  {file, clips:{q1:{s_ms,e_ms}, q1o1:{…}}}: every question clip in one file
--   story_pages.n           1 = the first story page (the cover is the book's cover_file, never a page)
--   story_pages.words       [{i, t, box:[x,y,w,h]}] in the page picture's pixels; box omitted where none
--   story_pages.watermark   true until the page is known watermark-free (its book swept and, if cleaned, looked at)
--   story_pages.lines       [{i0, i1, box:[x,y,w,h]}]: each printed line's first and last word and its box
--   story_pages.text_band   {file, w, h, box:[x,y,w,h]}: the band of the picture holding the printed words, at 2x
--   story_questions.audio   {q: file, o: [file, ...]}: the question and each option spoken, same voice as the book
--   story_page_voices       versioned: a re-voice adds a row and moves is_current, never overwrites
--   story_events            no phone and no name: a child id or a hashed hub token, a book, a page, numbers
-- Picture, voice and question files live in storage by content hash, never in this repository.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS story_books (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     text UNIQUE,
  slug          text UNIQUE NOT NULL,
  title         text NOT NULL,
  grade         smallint NOT NULL CHECK (grade BETWEEN 1 AND 5),
  lang          text NOT NULL CHECK (lang IN ('en', 'ur')),
  slo           text,
  slo_english   text,
  author        text,
  illustrator   text,
  pages         smallint NOT NULL DEFAULT 0,
  cover_file    text,
  cover_w       smallint,
  cover_h       smallint,
  pdf_r2_key    text,
  minutes       numeric(4,1),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'off')),
  featured_rank smallint,
  questions_sprite jsonb,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS story_books_shelf ON public.story_books (grade, lang) WHERE status = 'ready';

CREATE TABLE IF NOT EXISTS story_pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id       uuid NOT NULL REFERENCES story_books(id) ON DELETE CASCADE,
  n             smallint NOT NULL CHECK (n >= 1),
  image_file    text NOT NULL,
  image_w       smallint NOT NULL,
  image_h       smallint NOT NULL,
  text          text NOT NULL DEFAULT '',
  words         jsonb NOT NULL DEFAULT '[]',
  text_band     jsonb,
  lines         jsonb,
  boxes_ok      boolean NOT NULL DEFAULT false,
  text_source   text CHECK (text_source IN ('pdf', 'read+boxes', 'read')),
  confidence    numeric(3,2),
  is_picture    boolean NOT NULL DEFAULT false,
  watermark     boolean NOT NULL DEFAULT false,
  UNIQUE (book_id, n)
);

CREATE TABLE IF NOT EXISTS story_page_voices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id       uuid NOT NULL REFERENCES story_pages(id) ON DELETE CASCADE,
  lang          text NOT NULL,
  provider      text NOT NULL,
  voice         text NOT NULL,
  model         text,
  audio_key     text NOT NULL,
  timing_key    text,
  ms            integer NOT NULL,
  timings       jsonb NOT NULL,
  timing_source text NOT NULL CHECK (timing_source IN ('provider', 'stt_align', 'provider+stt', 'forced_align')),
  wpm           numeric(5,1),
  drift_ms_mean numeric(6,1),
  drift_ms_max  numeric(6,1),
  wer           numeric(4,3),
  cost_usd      numeric(8,5),
  is_current    boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS story_page_voices_current ON public.story_page_voices (page_id, lang) WHERE is_current;
-- 'low': the voice is kept but its word timings are not trusted, so the reader follows it line by line.
ALTER TABLE story_page_voices ADD COLUMN IF NOT EXISTS quality text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_page_voices_quality_check') THEN
    ALTER TABLE story_page_voices ADD CONSTRAINT story_page_voices_quality_check CHECK (quality IN ('low'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS story_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id       uuid NOT NULL REFERENCES story_books(id) ON DELETE CASCADE,
  n             smallint NOT NULL CHECK (n BETWEEN 1 AND 5),
  kind          text NOT NULL CHECK (kind IN ('literal', 'inference', 'vocab')),
  q             text NOT NULL,
  options       jsonb NOT NULL,
  answer_i      smallint NOT NULL CHECK (answer_i >= 0),
  page_ref      smallint,
  review_status text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'reviewed', 'rejected')),
  reviewer_note text,
  audio         jsonb,
  UNIQUE (book_id, n)
);

CREATE TABLE IF NOT EXISTS story_events (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  child_id      uuid,
  hub_token_hash text,
  book_id       uuid NOT NULL,
  page_n        smallint,
  event         text NOT NULL CHECK (event IN ('story_opened', 'story_page_listened', 'story_page_read', 'story_questions_done', 'story_done', 'story_shared')),
  data          jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS story_events_child_at ON public.story_events (child_id, at DESC);
CREATE INDEX IF NOT EXISTS story_events_book_at ON public.story_events (book_id, at DESC);

ALTER TABLE public.story_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_page_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_events ENABLE ROW LEVEL SECURITY;
