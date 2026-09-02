-- V1.2.8 — the 6-12 lesson-plan menu, and the renders it caches.
--
-- Two tables, for the same reason V1.2.6 used two: what the corpus knows about a
-- lesson is fully known the moment the segmentation fleet emits it, and what the
-- teacher is actually handed is not known until a model has authored it, a
-- renderer has drawn it and R2 has taken the bytes. One table would make half
-- its columns nullable because they are not known YET, which is a different
-- thing from optional and reads identically in the schema.
--
-- The split also buys the thing the serving path needs most: a segment with no
-- render is a perfectly ordinary row, so "has anyone ever asked for this lesson"
-- and "is it cached" are two different questions with two different answers,
-- and a failed author attempt stays on disk to be looked at instead of being
-- overwritten by the retry.

-- ---------------------------------------------------------------------------
-- niete_lp612_segments — the menu tree.
--
-- One row = one teaching DAY = one period (~40 min) = what one lp_doc serves.
-- Produced by the segmentation fleet (SEGMENTATION_PLAN.md) and loaded by
-- bot/scripts/import-lp612-segments.js. The importer is idempotent and keyed on
-- segment_id, so re-running it as books land is the normal case, not a repair.
--
-- The primary key is the corpus's own segment_id rather than a surrogate uuid,
-- deliberately. It is derived from (book, chapter, printed page range) — all
-- three read off the printed page — so a re-run of the fleet that draws the same
-- boundaries produces a byte-identical id, and the R2 render cached under it
-- stays valid. A boundary change DOES change the id, which is correct: the
-- segment now teaches different pages and its cached render is genuinely stale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS niete_lp612_segments (
  segment_id            TEXT PRIMARY KEY,

  -- Stamped from the book, never from the model that did the segmenting.
  book_stem             TEXT    NOT NULL,
  grade                 INTEGER NOT NULL CHECK (grade BETWEEN 6 AND 12),
  subject               TEXT    NOT NULL,
  medium                TEXT,
  -- The book's own language. Not the teacher's — that is a serving-time choice
  -- and lives on the render row, not here.
  language              TEXT    NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ur')),

  -- Stamped from the table of contents.
  chapter_number        INTEGER,
  chapter_title         TEXT,
  -- 'c02' for a flat book, 'p3c01' for the two Urdu books whose chapter
  -- numbering restarts inside each part. Without the part prefix, نثر ch.1 and
  -- غزل ch.1 collide on one id and one teacher gets the other's lesson.
  chapter_key           TEXT    NOT NULL,
  part                  TEXT,
  part_index            INTEGER,

  -- subtopic_title is the book's own heading wording; menu_title is the row a
  -- teacher taps. The caps are Meta's NavigationList limits measured in CODE
  -- POINTS, not bytes (root CLAUDE.md Rule 20). They are enforced in the
  -- importer, where a violation can be reported against a file and a line;
  -- a CHECK here would only be able to reject the whole load.
  subtopic_title        TEXT    NOT NULL,
  menu_title            TEXT    NOT NULL,
  section_ref           TEXT,

  -- PRINTED pages, not PDF indices. Three books in this corpus shift offset
  -- mid-book and one prints duplicate page numbers, so these are copied from
  -- the corpus verbatim and never recomputed from an offset.
  printed_page_start    INTEGER NOT NULL,
  printed_page_end      INTEGER NOT NULL,
  pages_covered         INTEGER[] NOT NULL DEFAULT '{}',

  -- order_index restarts per chapter (review day last); day_number is the
  -- sequential teaching-day ordinal across the whole book. Kept separate on
  -- purpose — surfacing an internal index where a human reads sequence is a
  -- defect the K-5 build already booked once.
  order_index           INTEGER NOT NULL,
  day_number            INTEGER,
  segment_index         INTEGER,

  lp_type               TEXT    NOT NULL DEFAULT 'content'
                          CHECK (lp_type IN ('content', 'exercise_review', 'assessment',
                                             'practical', 'revision')),
  skill_type            TEXT,
  -- Verbatim printed learning outcome, or null. Never invented.
  slo_text              TEXT,

  revision_source_segments TEXT[] NOT NULL DEFAULT '{}',
  prev_segment_id       TEXT,
  next_segment_id       TEXT,

  -- The YouTube swarm's landing slot: {url, video_id, title, channel, views,
  -- duration_sec, checked_at, ...} or null. Null is ordinary and the LP simply
  -- omits its video line — it is not an error and not a reason to withhold a
  -- lesson.
  yt                    JSONB,

  -- The operator's hard hold. Islamiat books and any seerah content are NOT
  -- served on demand until a native speaker has reviewed them, and the flag
  -- that lets them through (LP_612_RELIGIOUS_ENABLED) is separate from the
  -- feature's own flag so that turning the feature on cannot turn these on by
  -- accident. Computed by the importer, stored rather than derived, so the
  -- serving query is a plain equality filter and cannot be got wrong by a
  -- future caller re-deriving it from a title.
  is_religious          BOOLEAN NOT NULL DEFAULT FALSE,

  -- What the segmenter folded and why, for the human reviewer.
  notes                 TEXT,
  -- Which corpus run produced this row; lets a bad run be identified after the
  -- fact without diffing every segment.
  corpus_version        TEXT    NOT NULL DEFAULT 'v1',
  -- A segment retired by a re-run stays on the table (its renders reference it)
  -- but drops out of every menu query.
  is_current            BOOLEAN NOT NULL DEFAULT TRUE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The menu's own query: grade -> subject -> chapter -> subtopic, current rows only.
CREATE INDEX IF NOT EXISTS idx_lp612_segments_menu
  ON niete_lp612_segments (grade, subject, chapter_number, order_index)
  WHERE is_current;

-- The importer's upsert and the "what does this book contain" query.
CREATE INDEX IF NOT EXISTS idx_lp612_segments_book
  ON niete_lp612_segments (book_stem, chapter_key, order_index);

-- ---------------------------------------------------------------------------
-- niete_lp612_renders — the R2 cache ledger.
--
-- The cache key the operator locked is (segment_id, lang, template_version), and
-- it is a UNIQUE constraint rather than a convention because that constraint is
-- also the concurrency lock: two teachers tapping the same lesson in the same
-- minute race to INSERT, exactly one wins and enqueues an authoring job, and the
-- loser reads the winner's row and joins its waiter list. Without the
-- constraint that race authors the same lesson twice, at ~$1.50 and several
-- minutes a go.
--
-- template_version is part of the key so that shipping v9.2 does not require
-- deleting anything: the new version simply misses, authors, and caches
-- alongside, and a rollback re-serves the old renders instantly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS niete_lp612_renders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  segment_id        TEXT NOT NULL REFERENCES niete_lp612_segments(segment_id),
  -- The language the lesson was AUTHORED in (the teacher's choice), which is not
  -- necessarily the book's medium.
  lang              TEXT NOT NULL CHECK (lang IN ('en', 'ur')),
  template_version  TEXT NOT NULL,

  -- 'authoring' is a real state, not a null: it is what makes a second
  -- requester wait instead of starting a second run.
  status            TEXT NOT NULL DEFAULT 'authoring'
                      CHECK (status IN ('authoring', 'ready', 'failed')),

  -- Set on success. lp612/<template_version>/<lang>/<segment_id>.pdf
  r2_key            TEXT,
  page_count        INTEGER,

  -- Provenance of the render, so a quality question asked next month is
  -- answerable: which model, how many revision rounds it needed, and whether it
  -- ever actually came off the ladder clean.
  model_used        TEXT,
  rounds_used       INTEGER,
  lint_clean        BOOLEAN,
  lint_fails        JSONB,

  -- Set on failure. Kept rather than cleared on retry so a pattern of failures
  -- is visible instead of being overwritten one at a time.
  error_code        TEXT,
  error_detail      TEXT,

  -- Everyone waiting on THIS render: [{user_id, phone, requested_at}].
  -- A column rather than a table because it is bounded (the teachers who happen
  -- to tap one lesson inside one authoring window), it is consumed and cleared
  -- the moment the worker delivers, and it has no life of its own to query.
  waiters           JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Who caused this render to exist, and the correlation id of the request that
  -- did — so a slow first hit can be traced end to end in Axiom.
  requested_by      UUID REFERENCES users(id),
  correlation_id    TEXT,

  -- Wall-clock of the authoring run. first-hit latency is THE metric for this
  -- feature; storing both ends means it is measurable from the table rather
  -- than only from logs that roll off.
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT niete_lp612_renders_cache_key UNIQUE (segment_id, lang, template_version)
);

-- The serving path's only read: is there a ready render for this key?
CREATE INDEX IF NOT EXISTS idx_lp612_renders_lookup
  ON niete_lp612_renders (segment_id, lang, template_version, status);

-- The watchdog's query: what has been authoring for too long?
CREATE INDEX IF NOT EXISTS idx_lp612_renders_inflight
  ON niete_lp612_renders (started_at)
  WHERE status = 'authoring';

NOTIFY pgrst, 'reload schema';
