-- V1.6.20 — child_test: a self-administered battery (the child alone with the phone) on the same rows.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. In the coach's Learning assessment, and in the game's battery, the child takes the EGRA/EGMA
-- battery alone; the phone scores what it can on the spot (taps, keypad, times, stop rules) and records the
-- rest for later. A sampled child's battery already has its grain here — one child_test_sessions row per
-- drawn child, one child_test_blocks row per subtask — so Rule 15 adds nullable columns and widens CHECKs;
-- no new table.
--   sessions: how it was administered (admin_mode), the in-app-browser channel ('web'), a game-run draw
--             ('self' selection, an sa:<draw>:<date> visit key), and the device's own clock and sync state.
--   blocks:   the device's raw per-item evidence (responses), one clip per item (audio_r2_keys), the
--             language of the prompts (lang); the block name widens from the 21 v3 ids to any
--             '<subject>.<task>' id, so every battery subtask has its own row.
--   The write-once guard on AI marks now also freezes responses and audio_r2_keys.
--
-- DATA. None changed: every existing row satisfies every widened CHECK; new columns are NULL.
-- LOAD. CHECK validation scans of three small tables. SECURITY. Unchanged: RLS on, no policies.
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS; each CHECK dropped by name and re-added.
-- Rollback: ROLLBACK_V1.6.20__child_test_self_admin.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

-- sessions
ALTER TABLE child_test_sessions ADD COLUMN IF NOT EXISTS admin_mode text;
ALTER TABLE child_test_sessions ADD COLUMN IF NOT EXISTS client_session_id uuid;
ALTER TABLE child_test_sessions ADD COLUMN IF NOT EXISTS client_started_at timestamptz;
ALTER TABLE child_test_sessions ADD COLUMN IF NOT EXISTS client_finished_at timestamptz;
ALTER TABLE child_test_sessions ADD COLUMN IF NOT EXISTS synced_at timestamptz;
ALTER TABLE child_test_sessions ADD COLUMN IF NOT EXISTS device jsonb;

ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_admin_mode_check;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_admin_mode_check
  CHECK (admin_mode IS NULL OR admin_mode IN ('self_run', 'teacher_present', 'coach_present'));
ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_channel_check;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_channel_check
  CHECK (channel IN ('whatsapp', 'app', 'web'));
ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_selection_method_check;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_selection_method_check
  CHECK (selection_method IN ('random_draw', 'manual', 'self'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_child_test_sessions_client
  ON child_test_sessions (client_session_id) WHERE client_session_id IS NOT NULL;

-- the visit key gains sa:<draw uuid>:<YYYY-MM-DD> (a game run, no adult visit), on both tables
ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_visit_key_format;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_visit_key_format CHECK (visit_key IS NULL OR visit_key ~
  '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}|sa:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$');
ALTER TABLE child_test_draws DROP CONSTRAINT IF EXISTS child_test_draws_visit_key_format;
ALTER TABLE child_test_draws ADD CONSTRAINT child_test_draws_visit_key_format CHECK (visit_key IS NULL OR visit_key ~
  '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}|sa:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$');

COMMENT ON COLUMN child_test_sessions.admin_mode IS
  'Internal. self_run (child alone, game) | teacher_present | coach_present (proctored). NULL = the coach-recorded test.';
COMMENT ON COLUMN child_test_sessions.client_session_id IS 'Internal. Device-generated idempotency key for offline sync.';
COMMENT ON COLUMN child_test_sessions.client_started_at IS 'Internal. Device clock; compare with started_at for skew.';
COMMENT ON COLUMN child_test_sessions.synced_at IS 'Internal. When the server last received a batch from the device.';
COMMENT ON COLUMN child_test_sessions.device IS 'Internal. {ua, bundle_v, offline, skew_ms, last_seq}; no phone numbers, no names.';

-- blocks
ALTER TABLE child_test_blocks ADD COLUMN IF NOT EXISTS responses jsonb;
ALTER TABLE child_test_blocks ADD COLUMN IF NOT EXISTS audio_r2_keys jsonb;
ALTER TABLE child_test_blocks ADD COLUMN IF NOT EXISTS lang text;

ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_lang_check;
ALTER TABLE child_test_blocks ADD CONSTRAINT child_test_blocks_lang_check CHECK (lang IS NULL OR lang IN ('ur', 'en'));
ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_responses_shape;
ALTER TABLE child_test_blocks ADD CONSTRAINT child_test_blocks_responses_shape
  CHECK (responses IS NULL OR jsonb_typeof(responses) = 'array');
ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_audio_keys_shape;
ALTER TABLE child_test_blocks ADD CONSTRAINT child_test_blocks_audio_keys_shape
  CHECK (audio_r2_keys IS NULL OR jsonb_typeof(audio_r2_keys) = 'array');
ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_block_check;
ALTER TABLE child_test_blocks ADD CONSTRAINT child_test_blocks_block_check
  CHECK (block IN ('urdu', 'english', 'maths') OR block ~ '^[a-z]{2}\.[a-z0-9_]{1,40}$');

COMMENT ON COLUMN child_test_blocks.responses IS
  'PII-adjacent. Device capture: [{kind:result,...}, {kind:answer, ...per item}]. Frozen with ai_marks.';
COMMENT ON COLUMN child_test_blocks.audio_r2_keys IS 'Internal. Per-item clips [{i, key}] under child-test/{env}/...; frozen with ai_marks.';
COMMENT ON COLUMN child_test_blocks.lang IS 'Internal. Language of the prompts and audio for this subtask.';

-- the write-once guard now also covers the device evidence
CREATE OR REPLACE FUNCTION public.child_test_blocks_keep_marks() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF OLD.ai_marks IS NOT NULL AND (
       NEW.ai_marks IS DISTINCT FROM OLD.ai_marks
    OR NEW.ai_status IS DISTINCT FROM OLD.ai_status
    OR NEW.ai_model_versions IS DISTINCT FROM OLD.ai_model_versions
    OR NEW.ai_scored_at IS DISTINCT FROM OLD.ai_scored_at
    OR NEW.transcript IS DISTINCT FROM OLD.transcript
    OR NEW.audio_r2_key IS DISTINCT FROM OLD.audio_r2_key
    OR NEW.photo_r2_key IS DISTINCT FROM OLD.photo_r2_key
    OR NEW.responses IS DISTINCT FROM OLD.responses
    OR NEW.audio_r2_keys IS DISTINCT FROM OLD.audio_r2_keys
  ) THEN
    RAISE EXCEPTION 'child_test_blocks %: the AI marks are written once', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.checked_at IS NOT NULL AND (
       NEW.checked_at IS DISTINCT FROM OLD.checked_at
    OR NEW.coach_marks IS DISTINCT FROM OLD.coach_marks
    OR NEW.coach_edits IS DISTINCT FROM OLD.coach_edits
  ) THEN
    RAISE EXCEPTION 'child_test_blocks %: the coach check is submitted once', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
