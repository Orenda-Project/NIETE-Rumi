-- coaching_audio_hash.sql — bd-7beiz
--
-- Migration type: ADDITIVE ONLY, forward-only, no rollback needed. Two nullable
-- columns and one partial index. Nothing existing reads them, so applying this
-- migration changes no behaviour until the code that writes them ships.
--
-- Apply by hand in the Supabase SQL editor, the way every migration in this
-- directory is applied. One env = one DB: SANDBOX first, then staging, then
-- production on an explicit go. The code tolerates the columns being absent
-- only in the sense that nothing breaks loudly — until this migration runs,
-- the write below fails and the dedupe never hits, so it must land BEFORE the
-- bot deploy in each environment.
--
-- Ported from the upstream bot's equivalent migration, live there since
-- 2026-04-18.
--
-- Why: the same recording must produce the same score. The FICO rubric pass
-- runs gpt-5-mini at temperature 1 with no seed, so each submission is an
-- independent sample, and nothing stopped identical audio being sampled twice.
-- Measured on NIETE production 17 Aug – 20 Sep 2026, grouping DC sessions on
-- (user, duration, bytes): 1,515 duplicate groups covering 3,515 sessions,
-- mean overall spread 5.9 points, 335 groups ≥10 points, Section B spread
-- averaging 6.9 of 40 marks.
--
-- `audio_hash` is the SHA-256 hex digest of the uploaded audio bytes, written
-- on EVERY session (a hash written only on a hit could never produce one).
-- `duplicate_of_session_id` records which prior session a deduped one reused,
-- so the reuse rate is measurable rather than inferred.
--
-- No backfill: the original bytes are not recoverable for already-completed
-- sessions, so existing rows simply never match until they are re-submitted.

ALTER TABLE coaching_sessions
  ADD COLUMN IF NOT EXISTS audio_hash CHAR(64);

ALTER TABLE coaching_sessions
  ADD COLUMN IF NOT EXISTS duplicate_of_session_id UUID REFERENCES coaching_sessions(id);

-- Matches the lookup exactly: same user, same hash, completed, newest first.
-- Partial, because the rows it excludes can never satisfy that query.
CREATE INDEX IF NOT EXISTS idx_coaching_sessions_user_audio_hash
  ON coaching_sessions (user_id, audio_hash, created_at DESC)
  WHERE audio_hash IS NOT NULL AND status = 'completed';

COMMENT ON COLUMN coaching_sessions.audio_hash IS
  'SHA-256 hex digest of the uploaded audio bytes (bd-7beiz). Detects an identical resubmission so the prior analysis is reused instead of re-scored at temperature 1.';

COMMENT ON COLUMN coaching_sessions.duplicate_of_session_id IS
  'When this session was an identical resubmission, the session whose analysis it reused (bd-7beiz).';
