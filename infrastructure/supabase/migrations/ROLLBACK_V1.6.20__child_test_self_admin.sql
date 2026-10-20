-- ROLLBACK V1.6.20 — child_test: back to the coach-recorded test only.
--
-- Refuses while any self-administered evidence exists (a 'web' or 'self' session, an sa: visit key, a block
-- outside the 21 v3 ids, or any responses / per-item clips): narrowing would fail on those rows, and they
-- are a child's test evidence. Export them first, by hand, on purpose.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM child_test_sessions WHERE channel = 'web' OR selection_method = 'self' OR visit_key LIKE 'sa:%' OR admin_mode IS NOT NULL)
     OR EXISTS (SELECT 1 FROM child_test_draws WHERE visit_key LIKE 'sa:%')
     OR EXISTS (SELECT 1 FROM child_test_blocks WHERE responses IS NOT NULL OR audio_r2_keys IS NOT NULL
       OR block NOT IN ('urdu', 'english', 'maths', 'ur.listening', 'ur.letters', 'ur.nonwords', 'ur.words', 'ur.story', 'en.listening', 'en.letters', 'en.nonwords', 'en.words', 'en.story', 'ma.number_id', 'ma.discrimination', 'ma.missing', 'ma.add1', 'ma.sub1', 'ma.add2', 'ma.sub2', 'ma.word_problems')) THEN
    RAISE EXCEPTION 'ROLLBACK_V1.6.20: self-administered rows exist; export them first' USING ERRCODE = 'check_violation';
  END IF;
END
$$;

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

ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_block_check;
ALTER TABLE child_test_blocks ADD CONSTRAINT child_test_blocks_block_check
  CHECK (block IN ('urdu', 'english', 'maths', 'ur.listening', 'ur.letters', 'ur.nonwords', 'ur.words', 'ur.story', 'en.listening', 'en.letters', 'en.nonwords', 'en.words', 'en.story', 'ma.number_id', 'ma.discrimination', 'ma.missing', 'ma.add1', 'ma.sub1', 'ma.add2', 'ma.sub2', 'ma.word_problems'));
ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_lang_check;
ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_responses_shape;
ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_audio_keys_shape;
ALTER TABLE child_test_blocks DROP COLUMN IF EXISTS responses;
ALTER TABLE child_test_blocks DROP COLUMN IF EXISTS audio_r2_keys;
ALTER TABLE child_test_blocks DROP COLUMN IF EXISTS lang;

DROP INDEX IF EXISTS uq_child_test_sessions_client;
ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_admin_mode_check;
ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_channel_check;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_channel_check CHECK (channel IN ('whatsapp', 'app'));
ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_selection_method_check;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_selection_method_check CHECK (selection_method IN ('random_draw', 'manual'));
ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_visit_key_format;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_visit_key_format CHECK (visit_key IS NULL OR visit_key ~
  '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$');
ALTER TABLE child_test_draws DROP CONSTRAINT IF EXISTS child_test_draws_visit_key_format;
ALTER TABLE child_test_draws ADD CONSTRAINT child_test_draws_visit_key_format CHECK (visit_key IS NULL OR visit_key ~
  '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$');
ALTER TABLE child_test_sessions DROP COLUMN IF EXISTS admin_mode;
ALTER TABLE child_test_sessions DROP COLUMN IF EXISTS client_session_id;
ALTER TABLE child_test_sessions DROP COLUMN IF EXISTS client_started_at;
ALTER TABLE child_test_sessions DROP COLUMN IF EXISTS client_finished_at;
ALTER TABLE child_test_sessions DROP COLUMN IF EXISTS synced_at;
ALTER TABLE child_test_sessions DROP COLUMN IF EXISTS device;
