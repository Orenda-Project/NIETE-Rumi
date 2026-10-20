-- V1.6.18 — child_test: the self-administered battery's event log and per-task results.
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. In the coach's Learning assessment the child takes the battery alone on the coach's phone;
-- the phone scores what can be scored on the spot (taps, times, stop rules) and records the rest for
-- later. The session is still one child_test_sessions row (one per draw, channel 'app'), and a task's
-- recording still goes onto its child_test_blocks row when the task is one of the v3 blocks, so the
-- existing scorer can score it later. Two things have no home today:
--   1. the engine's event log — every tap, stop and handover, with a per-session sequence number, so
--      a phone that synced half a test and went offline re-sends from where the server stopped;
--   2. the phone's per-task result (attempted, correct, time used, stop reason) — not an AI mark and
--      not a coach mark, so it does not belong in ai_marks or coach_marks.
-- Rule 15: the smallest addition — two child tables of child_test_sessions, nothing existing altered.
--
-- DATA. None changed. LOAD. Two empty tables. SECURITY. As the other child_test tables: RLS on, no
-- policies, service role only. IDEMPOTENT. IF NOT EXISTS throughout.
-- Rollback: ROLLBACK_V1.6.18__child_test_sa.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS child_test_sa_events (
  session_id uuid NOT NULL REFERENCES child_test_sessions(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 0),
  t_ms integer,
  at timestamptz,
  type text NOT NULL,
  task_id text,
  item_id text,
  value jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS child_test_sa_results (
  session_id uuid NOT NULL REFERENCES child_test_sessions(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  audio_r2_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, task_id)
);

ALTER TABLE child_test_sa_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_test_sa_results ENABLE ROW LEVEL SECURITY;
