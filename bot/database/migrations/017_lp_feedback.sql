-- Migration 017: lp_feedback table for post-delivery "Was this useful?" survey
--
-- Ported 2026-07-12 from 02_Main Rumi Bot production migrations:
--   - add_lp_feedback.sql (base table + 3 indexes)
--   - 044_lp_feedback_reason_polarity.sql (reason_polarity column + index)
--
-- Merged into a single migration for NIETE — no historical data to backfill.
--
-- Contract:
--   - One row per (user, lesson_plan) button tap
--   - useful = true (👍) or false (👎)
--   - reason_text nullable; UPDATEd when teacher replies to "Tell us why?" within 10 min
--   - reason_polarity: 'liked' (👍-reason opt-in path; unused in NIETE MVP) OR
--                     'disliked' (👎 path — the only one NIETE MVP fires) OR
--                     'unknown' (legacy / non-reason rows)
--   - trigger_mode: 'after_pdf_only' (all NIETE MVP rows) OR 'after_voice_note'
--     (reserved for when audio-LP ships — see docs/roadmap/audio-lp.md)
--   - snapshot columns (lp_variant/grade/subject/chapter_number/segment_number/topic)
--     denormalized so queries don't have to JOIN back to lesson_plans (row may be
--     deleted or have NULLs).
--
-- Safe to re-run. Apply via Supabase SQL editor (service role).

CREATE TABLE IF NOT EXISTS lp_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  lesson_plan_id UUID REFERENCES lesson_plans(id) ON DELETE SET NULL,

  useful BOOLEAN NOT NULL,

  reason_text TEXT,
  reason_received_at TIMESTAMPTZ,
  reason_language TEXT,
  reason_polarity TEXT NOT NULL DEFAULT 'unknown'
    CHECK (reason_polarity IN ('liked', 'disliked', 'unknown')),

  -- Snapshot of LP context — feedback stays queryable even if lesson_plans row is lost
  lp_variant TEXT,
  grade INTEGER,
  subject TEXT,
  chapter_number INTEGER,
  segment_number INTEGER,
  topic TEXT,

  trigger_mode TEXT CHECK (trigger_mode IN ('after_voice_note', 'after_pdf_only')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lp_feedback_user_time
  ON lp_feedback (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lp_feedback_has_reason
  ON lp_feedback (created_at DESC)
  WHERE reason_text IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lp_feedback_useful_time
  ON lp_feedback (useful, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lp_feedback_polarity_time
  ON lp_feedback (reason_polarity, created_at DESC)
  WHERE reason_text IS NOT NULL;

COMMENT ON TABLE lp_feedback IS
  'Post-delivery survey responses for NIETE lesson plans. One row per button tap; '
  'reason_text is UPDATEd on the same row when the teacher replies to the follow-up '
  'prompt within the 10-min Redis window. Ported from 02_Main Rumi Bot 2026-07-12.';
