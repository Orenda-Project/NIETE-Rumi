-- V1.5.4 — coaching_sessions: declare the four observe columns the live databases already carry.
--
-- observation_type, observer_user_id, autofill_analysis_data and debrief_status have been written
-- by the observe stack since the HITL port (observe-capture.service.js, observe-draft.service.js)
-- and exist on every live database (measured 2026-09-22: VARCHAR(30), UUID, JSONB, VARCHAR(20),
-- plus the partial index below), but no file in this repo declared them, so the reference schema,
-- the conformance guards and every clone bootstrap were wrong about the table the code writes to.
-- This migration is a NO-OP where the columns exist and creates them where they do not.
--
-- No BEGIN/COMMIT: infrastructure/scripts/migrate.js wraps the file in one plpgsql transaction.
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS observation_type       VARCHAR(30);
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS observer_user_id       UUID;
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS autofill_analysis_data JSONB;
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS debrief_status         VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_coaching_sessions_observer_pending
  ON coaching_sessions (observer_user_id, created_at DESC)
  WHERE observation_type = 'leader_observation';

COMMENT ON COLUMN coaching_sessions.observation_type IS
  'NULL = the teacher''s own recording (Digital Coach). The only value ever written is '
  '''leader_observation'': a coach observing a teacher (HITL).';
COMMENT ON COLUMN coaching_sessions.observer_user_id IS
  'The coach who drives a leader_observation. user_id is the observed teacher and owns the row; '
  'the two are equal only on a bare capture where no teacher was bound before recording.';
COMMENT ON COLUMN coaching_sessions.autofill_analysis_data IS
  'Frozen v1 of the AI analysis on a leader_observation, written exactly once when analysis lands. '
  'analysis_data then holds the observer-edited v2. NULL on Digital Coach rows.';
COMMENT ON COLUMN coaching_sessions.debrief_status IS
  'pending | done: whether the observer''s debrief step has run for a leader_observation.';

NOTIFY pgrst, 'reload schema';
