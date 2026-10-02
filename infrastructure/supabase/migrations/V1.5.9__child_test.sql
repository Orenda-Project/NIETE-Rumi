-- V1.5.9 — child_test: the ICT coach-run child test (EGRA/EGMA, Grades 3 and 5) — who is drawn,
-- who was tested, and the AI's and the coach's marks per block (bd-s1oo0.3). Versioned migration.
-- Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. Three tables:
--   child_test_draws    one row per child in a class's frame per cycle (quarter). The frame is
--                       snapshotted at the cycle's first draw and every rank is written before any
--                       name is shown. Absences, refusals and promotions are recorded on the row.
--   child_test_sessions one row per child tested (one per draw).
--   child_test_blocks   one row per block (urdu / english / maths) of a session: the recording, the
--                       AI's marks (written once, never changed) and the coach's marks next to them.
--
-- WHY TABLES (Rule 15, checked live on NIETE sandbox 2026-10-02; full note in the L3 lane folder,
-- SCHEMA_DECISION.md):
--   · reading_assessments is a one-row-per-reading main-bot shape: passage_text NOT NULL, no
--     student_id (free-text name instead), no maths, no AI-vs-coach pair, no draw or visit link;
--   · aser_sessions / numeracy_assessments do not exist in NIETE;
--   · the draw cannot be recomputed instead of stored — the frame must be snapshotted (students
--     keeps no history) and absences are events.
--   No column is added to any existing table.
--
-- DATA. Ids, roll numbers, grades, marks, storage keys. No child names (the coach's list reads
-- names from students at display time). transcript / ai_marks / coach_marks hold what the child
-- said; the recordings themselves are in R2 under child-test/{env}/... .
-- LOAD. ≤ 40 frame rows per class per quarter; ≤ 10 row updates per visit; 1 session + 3 blocks per
-- child tested. One indexed read (school_id, cycle_id) per /egra open.
-- SECURITY. RLS on, no policies, anon/authenticated revoked: the bot's service role only.
-- IDEMPOTENT. IF NOT EXISTS / DROP ... IF EXISTS throughout.
-- Rollback: ROLLBACK_V1.5.9__child_test.sql
-- ORDER. Apply before setting CHILD_TEST_ENABLED.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS child_test_draws (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id              text NOT NULL CHECK (cycle_id ~ '^[A-Z]+-[0-9]{4}-Q[1-4]$'),
  region                text NOT NULL,
  school_id             uuid NOT NULL REFERENCES schools(id),
  class_id              uuid NOT NULL REFERENCES classes(id),
  grade                 smallint NOT NULL CHECK (grade IN (3, 5)),
  student_id            uuid NOT NULL REFERENCES students(id),
  roll_number           integer,
  frame_size            integer NOT NULL CHECK (frame_size > 0),
  draw_rank             integer NOT NULL CHECK (draw_rank > 0),
  seed_digest           text NOT NULL,
  algo_version          text NOT NULL,
  sample_role           text NOT NULL DEFAULT 'new' CHECK (sample_role IN ('new', 'returning')),
  form                  text NOT NULL CHECK (form IN ('A', 'B')),
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'listed', 'tested', 'absent', 'refused', 'absent_final')),
  list_slot             text CHECK (list_slot IN ('main', 'alternate')),
  attempts              smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- SET NULL: the draw is the sampling record and outlives a deleted visit.
  last_listed_visit_id  uuid REFERENCES observation_field_forms(id) ON DELETE SET NULL,
  outcome_at            timestamptz,
  outcome_note          text,
  tested_at             timestamptz,
  source_draw_id        uuid REFERENCES child_test_draws(id),
  history               jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (sample_role = 'new' OR source_draw_id IS NOT NULL),
  CHECK (status <> 'tested' OR tested_at IS NOT NULL)
);

-- A class's frame is written once per cycle: two racing first draws cannot both write ranks.
CREATE UNIQUE INDEX IF NOT EXISTS uq_child_test_draws_rank
  ON child_test_draws (cycle_id, class_id, draw_rank) WHERE sample_role = 'new';
-- A child is drawn at most once as new and once as returning per cycle.
CREATE UNIQUE INDEX IF NOT EXISTS uq_child_test_draws_student
  ON child_test_draws (cycle_id, student_id, sample_role);
-- The one read todaysList makes.
CREATE INDEX IF NOT EXISTS idx_child_test_draws_school_cycle
  ON child_test_draws (school_id, cycle_id);
-- Reopening a visit's list.
CREATE INDEX IF NOT EXISTS idx_child_test_draws_visit
  ON child_test_draws (last_listed_visit_id) WHERE last_listed_visit_id IS NOT NULL;
-- The returning rule: earliest-tested child in the school and grade.
CREATE INDEX IF NOT EXISTS idx_child_test_draws_tested
  ON child_test_draws (school_id, grade, tested_at) WHERE status = 'tested';

CREATE TABLE IF NOT EXISTS child_test_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id            uuid NOT NULL REFERENCES child_test_draws(id),
  coach_user_id      uuid NOT NULL REFERENCES users(id),
  visit_id           uuid REFERENCES observation_field_forms(id) ON DELETE SET NULL,
  school_id          uuid NOT NULL REFERENCES schools(id),
  class_id           uuid NOT NULL REFERENCES classes(id),
  grade              smallint NOT NULL CHECK (grade IN (3, 5)),
  student_id         uuid NOT NULL REFERENCES students(id),
  form               text NOT NULL CHECK (form IN ('A', 'B')),
  channel            text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'app')),
  selection_method   text NOT NULL DEFAULT 'random_draw' CHECK (selection_method IN ('random_draw', 'manual')),
  frame_size         integer NOT NULL CHECK (frame_size > 0),
  item_bank_version  text,
  status             text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  timings            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_child_test_sessions_draw ON child_test_sessions (draw_id);
CREATE INDEX IF NOT EXISTS idx_child_test_sessions_visit
  ON child_test_sessions (visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_child_test_sessions_coach_recent
  ON child_test_sessions (coach_user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS child_test_blocks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES child_test_sessions(id) ON DELETE CASCADE,
  block              text NOT NULL CHECK (block IN ('urdu', 'english', 'maths')),
  audio_r2_key       text,
  photo_r2_key       text,
  transcript         jsonb,
  ai_marks           jsonb,
  ai_status          text NOT NULL DEFAULT 'pending'
                     CHECK (ai_status IN ('pending', 'scoring', 'scored', 'partial', 'failed')),
  ai_reason          text,
  ai_model_versions  jsonb,
  ai_scored_at       timestamptz,
  coach_marks        jsonb,
  coach_edits        jsonb,
  checked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (ai_marks IS NULL OR ai_status IN ('scored', 'partial'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_child_test_blocks_session_block
  ON child_test_blocks (session_id, block);

DROP TRIGGER IF EXISTS update_child_test_draws_updated_at ON child_test_draws;
CREATE TRIGGER update_child_test_draws_updated_at
  BEFORE UPDATE ON child_test_draws FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_child_test_sessions_updated_at ON child_test_sessions;
CREATE TRIGGER update_child_test_sessions_updated_at
  BEFORE UPDATE ON child_test_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_child_test_blocks_updated_at ON child_test_blocks;
CREATE TRIGGER update_child_test_blocks_updated_at
  BEFORE UPDATE ON child_test_blocks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The draw's ranks and frame are fixed once written: no redraw by UPDATE.
CREATE OR REPLACE FUNCTION child_test_draws_keep_rank() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.draw_rank IS DISTINCT FROM OLD.draw_rank
    OR NEW.frame_size IS DISTINCT FROM OLD.frame_size
    OR NEW.seed_digest IS DISTINCT FROM OLD.seed_digest
    OR NEW.algo_version IS DISTINCT FROM OLD.algo_version
    OR NEW.student_id IS DISTINCT FROM OLD.student_id
    OR NEW.class_id IS DISTINCT FROM OLD.class_id
    OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id
    OR NEW.sample_role IS DISTINCT FROM OLD.sample_role
    OR NEW.form IS DISTINCT FROM OLD.form THEN
    RAISE EXCEPTION 'child_test_draws %: a drawn rank cannot change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS child_test_draws_keep_rank ON child_test_draws;
CREATE TRIGGER child_test_draws_keep_rank
  BEFORE UPDATE ON child_test_draws FOR EACH ROW EXECUTE FUNCTION child_test_draws_keep_rank();

-- The AI's first mark is the constant ruler; the coach's check is submitted once.
CREATE OR REPLACE FUNCTION child_test_blocks_keep_marks() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ai_marks IS NOT NULL AND (
       NEW.ai_marks IS DISTINCT FROM OLD.ai_marks
    OR NEW.ai_status IS DISTINCT FROM OLD.ai_status
    OR NEW.ai_model_versions IS DISTINCT FROM OLD.ai_model_versions
    OR NEW.ai_scored_at IS DISTINCT FROM OLD.ai_scored_at
    OR NEW.transcript IS DISTINCT FROM OLD.transcript
    OR NEW.audio_r2_key IS DISTINCT FROM OLD.audio_r2_key
    OR NEW.photo_r2_key IS DISTINCT FROM OLD.photo_r2_key
  ) THEN
    RAISE EXCEPTION 'child_test_blocks %: the AI marks are written once', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.checked_at IS NOT NULL AND (
       NEW.checked_at IS DISTINCT FROM OLD.checked_at
    OR NEW.coach_marks IS DISTINCT FROM OLD.coach_marks
    OR NEW.coach_edits IS DISTINCT FROM OLD.coach_edits
  ) THEN
    RAISE EXCEPTION 'child_test_blocks %: the coach check is submitted once', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS child_test_blocks_keep_marks ON child_test_blocks;
CREATE TRIGGER child_test_blocks_keep_marks
  BEFORE UPDATE ON child_test_blocks FOR EACH ROW EXECUTE FUNCTION child_test_blocks_keep_marks();

ALTER TABLE child_test_draws ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_test_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON child_test_draws, child_test_sessions, child_test_blocks FROM anon, authenticated;

COMMENT ON TABLE child_test_draws IS
  'Internal. Child test (ICT EGRA/EGMA): one row per child in a class frame per cycle, with the seeded rank, the sampling role (new/returning), the form, and every listing and outcome. Ranks are fixed once written (trigger). Owner: Digital Coach team.';
COMMENT ON COLUMN child_test_draws.cycle_id IS 'Internal. Measurement window, e.g. ICT-2026-Q4 (calendar quarter).';
COMMENT ON COLUMN child_test_draws.frame_size IS 'Internal. Active children in the class at the cycle''s first draw; the selection weight.';
COMMENT ON COLUMN child_test_draws.draw_rank IS 'Internal. 1..frame_size, from the seeded shuffle; children are listed in this order.';
COMMENT ON COLUMN child_test_draws.seed_digest IS 'Internal. SHA-256 of the per-class-per-cycle seed (HMAC of the server secret); the secret itself is never stored.';
COMMENT ON COLUMN child_test_draws.algo_version IS 'Internal. The shuffle algorithm that produced draw_rank.';
COMMENT ON COLUMN child_test_draws.roll_number IS 'Internal. The roll number at the draw (snapshot).';
COMMENT ON COLUMN child_test_draws.status IS 'Internal. pending / listed / tested / absent / refused (back in the queue) / absent_final (two tries).';
COMMENT ON COLUMN child_test_draws.list_slot IS 'Internal. main or alternate on the visit list named by last_listed_visit_id.';
COMMENT ON COLUMN child_test_draws.history IS 'Internal. Every listing, outcome and promotion: {event, visit_id, at, ...}; ids only.';
COMMENT ON COLUMN child_test_draws.outcome_note IS 'PII. The coach''s note on an absence or refusal; may name a child.';
COMMENT ON COLUMN child_test_draws.source_draw_id IS 'Internal. For a returning child, the draw row of their first test.';
COMMENT ON TABLE child_test_sessions IS
  'Internal. Child test: one row per child tested (one per draw), with the visit, the coach, the form and the timings. Owner: Digital Coach team.';
COMMENT ON COLUMN child_test_sessions.frame_size IS 'Internal. Copied from the draw: class size at the draw, for weighting.';
COMMENT ON COLUMN child_test_sessions.timings IS 'Internal. {"<block>.<event>": iso time}; first write of a key wins.';
COMMENT ON TABLE child_test_blocks IS
  'PII. Child test: one row per block (urdu/english/maths) of a session: storage keys of the recording and the maths photo, the transcript, the AI''s marks (written once, trigger) and the coach''s marks and edits (submitted once). Owner: Digital Coach team.';
COMMENT ON COLUMN child_test_blocks.transcript IS 'PII. What the child said (speech-to-text with timestamps).';
COMMENT ON COLUMN child_test_blocks.ai_marks IS 'Internal. ai-marks-v1; written once and never changed — the constant ruler.';
COMMENT ON COLUMN child_test_blocks.coach_marks IS 'Internal. The coach''s confirmed marks, same shape as ai_marks.';
COMMENT ON COLUMN child_test_blocks.coach_edits IS 'Internal. [{path, ai, coach}] for every field the coach changed.';

NOTIFY pgrst, 'reload schema';
