-- V1.5.7 — observation_field_forms: one row per /observe2 coach visit. Versioned migration.
-- Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. /observe2 is the FICO ICT field form, piloted on sandbox: the coach records what they see
-- DURING the lesson (Part 1, Part 2), seals it before anything from Rumi is shown, then confirms the
-- moments Rumi found in the recording and checks the levels they add up to. This row holds all of
-- it, and is the pair (coach alone vs Rumi) the evals work is waiting for.
--
-- WHY A TABLE (checked against the sandbox schema, 30 Sep 2026: coaching_sessions has 65 columns,
-- none for a field form, and no CHECK on status). The record starts when the coach taps Start,
-- before the recording exists, i.e. before its coaching_sessions row does. Creating that row early
-- instead is unsafe:
--   · the observed teacher's /status reads coaching_sessions by user_id and lets her cancel an
--     in-progress row — for the whole lesson;
--   · an insert without an explicit status defaults to 'initiated' and is swept to 'abandoned'
--     after 30 minutes by the stale-session worker;
--   · the classroom-recording dedupe cancels a duplicate row, and analysis_data has three
--     wholesale writers — neither can hold a record that must never change once sealed;
--   · conversation_state is a mutable scratch column with several writers.
-- A new table is the last resort, and it is the one that fits. The coaching_sessions row is still
-- created when the recording arrives, exactly as for /observe, and linked here.
--
-- LIFECYCLE. Created at Start; answers saved as each part is saved; sealed once (sealed_at, set by
-- compare-and-set; the trigger below refuses any later change to what was sealed); linked to the
-- session when the recording arrives; Rumi's moments and levels written after analysis (never
-- shown to the coach); the coach's evidence review and final levels written by the check.
--
-- DATA. Ids, answers to plain questions, counts and timestamps; no phone and no name. Free text the
-- coach types (notes, what happened, why a level changed) and the quotes Rumi found in the
-- recording may name a child, so those columns are labelled PII. Photos are storage keys of boards
-- and notebooks (the form says: never faces).
-- LOAD. Sandbox pilot: tens of rows. At ICT scale ~110 coach visits a school day, ~25k rows a year.
-- One read per event, by id or by (observer_user_id, created_at DESC).
-- IDEMPOTENT. IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS throughout.
-- Rollback: ROLLBACK_V1.5.7__observation_field_forms.sql
-- ORDER. Apply BEFORE the code that writes observation_field_forms.
-- ATOMIC without BEGIN/COMMIT: infrastructure/scripts/migrate.js sends the file as ONE exec_sql call,
-- which is one transaction, and exec_sql cannot execute transaction commands.

CREATE TABLE IF NOT EXISTS observation_field_forms (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observer_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: the coach's record outlives the teacher's account and the session row.
  teacher_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  coaching_session_id  uuid REFERENCES coaching_sessions(id) ON DELETE SET NULL,
  rubric_version       text NOT NULL,
  period_minutes       smallint CHECK (period_minutes BETWEEN 20 AND 90),
  visit_context        jsonb NOT NULL DEFAULT '{}'::jsonb,
  answers              jsonb NOT NULL DEFAULT '{}'::jsonb,
  photos               jsonb NOT NULL DEFAULT '[]'::jsonb,
  opened_at            timestamptz,
  part1_done_at        timestamptz,
  part2_done_at        timestamptz,
  sealed_at            timestamptz,
  rumi_moments         jsonb,
  rumi_levels          jsonb,
  moments_ready_at     timestamptz,
  evidence_review      jsonb NOT NULL DEFAULT '{}'::jsonb,
  final_levels         jsonb,
  checked_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- The coach's open form (the capture link and the resume), newest first.
CREATE INDEX IF NOT EXISTS idx_observation_field_forms_observer_recent
  ON observation_field_forms (observer_user_id, created_at DESC);
-- One form per session; the lookup from the analysis branch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_observation_field_forms_session
  ON observation_field_forms (coaching_session_id) WHERE coaching_session_id IS NOT NULL;
-- The teacher's foreign key.
CREATE INDEX IF NOT EXISTS idx_observation_field_forms_teacher
  ON observation_field_forms (teacher_user_id) WHERE teacher_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_observation_field_forms_updated_at ON observation_field_forms;
CREATE TRIGGER update_observation_field_forms_updated_at
  BEFORE UPDATE ON observation_field_forms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- What the coach sealed cannot change afterwards, whoever writes. Photos are left out on purpose:
-- their storage keys arrive after the seal, when the uploaded pictures have been copied across.
CREATE OR REPLACE FUNCTION observation_field_forms_keep_seal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sealed_at IS NOT NULL AND (
       NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
    OR NEW.answers IS DISTINCT FROM OLD.answers
    OR NEW.period_minutes IS DISTINCT FROM OLD.period_minutes
    OR NEW.part1_done_at IS DISTINCT FROM OLD.part1_done_at
    OR NEW.part2_done_at IS DISTINCT FROM OLD.part2_done_at
    OR NEW.observer_user_id IS DISTINCT FROM OLD.observer_user_id
  ) THEN
    RAISE EXCEPTION 'observation_field_forms %: a sealed record cannot change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS observation_field_forms_keep_seal ON observation_field_forms;
CREATE TRIGGER observation_field_forms_keep_seal
  BEFORE UPDATE ON observation_field_forms
  FOR EACH ROW
  EXECUTE FUNCTION observation_field_forms_keep_seal();

COMMENT ON TABLE observation_field_forms IS
  'Internal. One row per /observe2 coach visit: the coach''s live field form (sealed before anything from Rumi is shown), Rumi''s moments and levels (never shown to the coach), and the coach''s evidence review and final levels. Owner: Digital Coach team.';
COMMENT ON COLUMN observation_field_forms.id IS 'Internal. Primary key; the record id in both /observe2 flow tokens.';
COMMENT ON COLUMN observation_field_forms.observer_user_id IS 'Internal. The coach (users.id).';
COMMENT ON COLUMN observation_field_forms.teacher_user_id IS 'Internal. The observed teacher (users.id), when known at Start.';
COMMENT ON COLUMN observation_field_forms.coaching_session_id IS 'Internal. The coaching_sessions row of the lesson recording, linked when the recording arrives.';
COMMENT ON COLUMN observation_field_forms.rubric_version IS 'Internal. The FICO ICT rubric version the form and the rule were built from.';
COMMENT ON COLUMN observation_field_forms.period_minutes IS 'Internal. The period length the coach chose; its halves are Part 1 and Part 2.';
COMMENT ON COLUMN observation_field_forms.visit_context IS 'Internal. Ids from the visit planner (teacher_ext_id, school_ext_id); no names.';
COMMENT ON COLUMN observation_field_forms.answers IS 'PII. The coach''s answers per part and at the seal; the free-text notes may name a child.';
COMMENT ON COLUMN observation_field_forms.photos IS 'Confidential. Storage keys of the photos taken with the form (boards, notebooks; never faces).';
COMMENT ON COLUMN observation_field_forms.opened_at IS 'Internal. When the coach first opened the form (server time).';
COMMENT ON COLUMN observation_field_forms.part1_done_at IS 'Internal. When Part 1 was saved: the halfway mark (server time).';
COMMENT ON COLUMN observation_field_forms.part2_done_at IS 'Internal. When Part 2 was saved (server time).';
COMMENT ON COLUMN observation_field_forms.sealed_at IS 'Internal. When the coach sealed the record (server time); set once, never changed.';
COMMENT ON COLUMN observation_field_forms.rumi_moments IS 'PII. The moments Rumi found in the recording, with the minute and the words; may name a child.';
COMMENT ON COLUMN observation_field_forms.rumi_levels IS 'Internal. Rumi''s own levels on the 17, from all its moments; never shown to the coach.';
COMMENT ON COLUMN observation_field_forms.moments_ready_at IS 'Internal. When Rumi''s moments were stored.';
COMMENT ON COLUMN observation_field_forms.evidence_review IS 'PII. The coach''s yes/no on each moment, the levels chosen and why; the reason may name a child.';
COMMENT ON COLUMN observation_field_forms.final_levels IS 'Internal. The final level on each of the 17 after the coach''s check.';
COMMENT ON COLUMN observation_field_forms.checked_at IS 'Internal. When the coach submitted the check (server time).';
COMMENT ON COLUMN observation_field_forms.created_at IS 'Internal. Row creation (UTC).';
COMMENT ON COLUMN observation_field_forms.updated_at IS 'Internal. Last change (UTC), by trigger.';

NOTIFY pgrst, 'reload schema';
