-- V1.7.4 — child_test: a reviewer's mark per item of a self-administered session, next to the scoring agents' marks.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. After a school visit the reviewers relisten to each recording and judge, item by item, whether the app scored
-- it right. Two sources meet on one row per (session, task, item):
--   agents   the independent scoring agents' marks for the item (consensus, each agent's mark, confidence, no-speech,
--            disputed, low-trust) — marks and numbers only, never what the child said or a transcript;
--   review   the reviewer's own ear: correct | wrong | unclear, a short note, who and when.
-- The app's own marks stay on child_test_blocks.ai_marks (write-once); nothing here changes them.
--
-- DATA. A new empty table. LOAD. None. SECURITY. RLS on, no policies: the service role only, like every child_test
-- table; the portal reaches it through the bot with the reviewer's own session. SENSITIVITY. Linked to a child's
-- session (child data). No PII: notes must not carry a child's name (the page says so, and the bot refuses a note
-- holding the child's roster name). OWNER. The child-test service.
-- IDEMPOTENT. CREATE … IF NOT EXISTS; each CHECK dropped by name and re-added.
-- Rollback: ROLLBACK_V1.7.4__child_test_sa_item_reviews.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS child_test_sa_item_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES child_test_sessions (id) ON DELETE CASCADE,
  task_id text NOT NULL,
  item_key text NOT NULL,
  agents jsonb,
  agents_run_at timestamptz,
  mark text,
  note text,
  reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE child_test_sa_item_reviews DROP CONSTRAINT IF EXISTS child_test_sa_item_reviews_task_check;
ALTER TABLE child_test_sa_item_reviews ADD CONSTRAINT child_test_sa_item_reviews_task_check
  CHECK (task_id ~ '^[a-z]{2}\.[a-z0-9_]{1,40}$');
ALTER TABLE child_test_sa_item_reviews DROP CONSTRAINT IF EXISTS child_test_sa_item_reviews_item_check;
ALTER TABLE child_test_sa_item_reviews ADD CONSTRAINT child_test_sa_item_reviews_item_check
  CHECK (item_key ~ '^[0-9]{1,3}$');
ALTER TABLE child_test_sa_item_reviews DROP CONSTRAINT IF EXISTS child_test_sa_item_reviews_mark_check;
ALTER TABLE child_test_sa_item_reviews ADD CONSTRAINT child_test_sa_item_reviews_mark_check
  CHECK (mark IS NULL OR mark IN ('correct', 'wrong', 'unclear'));
ALTER TABLE child_test_sa_item_reviews DROP CONSTRAINT IF EXISTS child_test_sa_item_reviews_note_check;
ALTER TABLE child_test_sa_item_reviews ADD CONSTRAINT child_test_sa_item_reviews_note_check
  CHECK (note IS NULL OR char_length(note) <= 500);
ALTER TABLE child_test_sa_item_reviews DROP CONSTRAINT IF EXISTS child_test_sa_item_reviews_reviewed_check;
ALTER TABLE child_test_sa_item_reviews ADD CONSTRAINT child_test_sa_item_reviews_reviewed_check
  CHECK ((mark IS NULL AND note IS NULL) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_child_test_sa_item_reviews_item
  ON child_test_sa_item_reviews (session_id, task_id, item_key);

ALTER TABLE child_test_sa_item_reviews ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE child_test_sa_item_reviews IS
  'Child data (linked to a child''s session). Owner: child-test service. One row per item of a self-administered session: the scoring agents'' marks and a reviewer''s own mark. Never a name or a transcript.';
COMMENT ON COLUMN child_test_sa_item_reviews.agents IS
  'The scoring agents'' marks for the item: consensus, flash, pro, stt (c|w|n|s), confidence, no_speech, disputed, low_trust. No transcript.';
COMMENT ON COLUMN child_test_sa_item_reviews.mark IS 'The reviewer''s ear: correct | wrong | unclear.';
COMMENT ON COLUMN child_test_sa_item_reviews.note IS 'Free text, at most 500 characters; the page asks never to type a child''s name.';
