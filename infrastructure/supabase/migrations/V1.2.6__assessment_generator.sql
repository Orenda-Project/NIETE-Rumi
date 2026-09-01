-- V1.2.6 — what a teacher asked for, and what came back.
--
-- Two tables rather than one. The request is fully known the moment she submits
-- it; the paper is not known until a worker has run a model, rendered a document
-- and uploaded it. Putting both in one row would make half its columns nullable
-- purely because they are not known YET, which is a different thing from
-- optional and reads the same in the schema.
--
-- Splitting them also buys two things worth having: a request with no paper is
-- findable (that is the watchdog's query), and a retry becomes a second paper
-- row rather than an overwrite, so a failure is still there to look at.

-- ---------------------------------------------------------------------------
-- The catalogue is missing a subject the ICT curriculum teaches in all five
-- grades. Added here rather than in the import, because a foreign key that can
-- fail on a Tuesday is not a foreign key.
-- ---------------------------------------------------------------------------
INSERT INTO subjects (code, aliases, sort_order, is_active)
VALUES ('islamiat', ARRAY['islamiat', 'Islamiat', 'Islamiyat', 'اسلامیات'], 70, TRUE)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- assessment_requests — what she asked for. Nothing here is nullable because it
-- is unknown; a column is nullable only when the answer is genuinely "none".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),

  -- Where she asked from. 'api' is here so an internal tool or a future surface
  -- does not need a migration to exist.
  surface           TEXT NOT NULL DEFAULT 'whatsapp'
                      CHECK (surface IN ('whatsapp', 'portal', 'api')),

  -- Foreign keys, not strings. The lookups carry alias arrays, so "Maths" and
  -- "Mathematics" resolve at the boundary and only one of them is ever stored —
  -- a paper cannot end up filed under two spellings of one subject.
  grade_code        TEXT NOT NULL REFERENCES grade_levels(code),
  subject_code      TEXT NOT NULL REFERENCES subjects(code),
  textbook_id       UUID NOT NULL REFERENCES textbooks(id),

  -- Exactly one of these is how she chose what to cover. chapter_number is null
  -- when she typed page numbers instead; page_ranges is always filled, because
  -- by the time we store the request we have resolved her chapter to pages.
  chapter_number    INTEGER,
  page_ranges       TEXT NOT NULL,

  content_source    TEXT NOT NULL DEFAULT 'unseen'
                      CHECK (content_source IN ('seen', 'unseen', 'both')),
  question_count    INTEGER NOT NULL CHECK (question_count BETWEEN 1 AND 60),
  question_types    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- empty = we chose
  has_answer_key    BOOLEAN NOT NULL DEFAULT FALSE,
  has_answer_lines  BOOLEAN NOT NULL DEFAULT TRUE,
  output_format     TEXT NOT NULL DEFAULT 'pdf' CHECK (output_format IN ('pdf', 'docx')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_requests_user_time
  ON assessment_requests (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- assessment_papers — what came back. Nullable throughout, honestly so.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_papers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            UUID NOT NULL REFERENCES assessment_requests(id) ON DELETE CASCADE,
  attempt               SMALLINT NOT NULL DEFAULT 1,

  status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'generating', 'ready', 'failed')),

  -- The living document. Edits write back here, which is what makes the review
  -- step a re-render rather than a regeneration.
  exam_json             JSONB,
  -- The model's first answer, frozen. The gap between this and exam_json is the
  -- only unprompted signal we will ever get on whether the prompts are good.
  original_exam_json    JSONB,
  -- Her ticks, as path ids into exam_json. NULL means not chosen yet, so all of
  -- them; '[]' means she genuinely unticked every one. The distinction matters.
  selected_question_ids JSONB,

  question_count        INTEGER,
  total_marks           INTEGER,
  file_r2_key           TEXT,

  error_code            TEXT,     -- NO_CONTENT | BAD_JSON | TRUNCATED | RENDER_FAILED | …
  error_detail          TEXT,

  model                 TEXT,
  input_tokens          INTEGER,
  output_tokens         INTEGER,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at              TIMESTAMPTZ,
  edited_at             TIMESTAMPTZ,

  UNIQUE (request_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_assessment_papers_request
  ON assessment_papers (request_id, attempt DESC);

-- The watchdog's index: jobs still in flight, oldest first. Partial, because the
-- rows it looks for are a handful and the ready ones are all of them.
CREATE INDEX IF NOT EXISTS idx_assessment_papers_inflight
  ON assessment_papers (created_at)
  WHERE status IN ('queued', 'generating');

COMMENT ON TABLE assessment_requests IS
  'One row per assessment a teacher asked us to build. Owner: NIETE bot team.';
COMMENT ON TABLE assessment_papers IS
  'One row per attempt at building it. A retry is a new row, so a failure stays '
  'visible. Owner: NIETE bot team.';
COMMENT ON COLUMN assessment_papers.selected_question_ids IS
  'Internal. Path ids into exam_json. NULL = not chosen yet (all questions kept); '
  '[] = she unticked every one.';
COMMENT ON COLUMN assessment_papers.error_detail IS
  'Internal. Never write a name, phone number or CNIC here.';
