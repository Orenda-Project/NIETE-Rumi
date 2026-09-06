-- Live voice calls: log, transcript, audit trail, memory, recall corpus (bd-1hae7.11)
--
-- Four tables, anti-sprawl audited against the 76-table schema:
--   calls             one row per call — both-side transcript + the EXACT context
--                     snapshot, so any call can be reconstructed after the fact
--   call_trace        one row per tool invocation (and safety flag, via `kind`)
--   call_memory       bounded rolling summary per caller, REWRITTEN not appended
--   call_recall_docs  the Tier-B corpus the recall tools search
--
-- Deliberately NOT new tables: the context snapshot rides `calls` as jsonb, and
-- safety flags ride `call_trace` with kind='safety' rather than a fifth table.
--
-- Idempotent: safe to re-run on staging and prod.

CREATE TABLE IF NOT EXISTS calls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_call_id       TEXT UNIQUE NOT NULL,
  caller_number    TEXT NOT NULL,
  caller_name      TEXT,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,
  status           TEXT,
  model            TEXT,
  voice            TEXT,
  transcript       JSONB,          -- [{role:'caller'|'assistant', text, at}]
  context_snapshot JSONB,          -- exact instructions at connect + which blocks resolved
  cost_estimate    NUMERIC(8,4),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calls_number_started ON calls (caller_number, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls (started_at DESC);

CREATE TABLE IF NOT EXISTS call_trace (
  id             BIGSERIAL PRIMARY KEY,
  wa_call_id     TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'tool',   -- 'tool' | 'safety' | 'latency'
  tool_name      TEXT,
  args_json      JSONB,
  result_preview TEXT,                            -- first ~1KB, for the viewer
  result_bytes   INTEGER,
  latency_ms     INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_call_trace_call ON call_trace (wa_call_id, seq);

CREATE TABLE IF NOT EXISTS call_memory (
  caller_number TEXT PRIMARY KEY,
  user_id       UUID,
  summary       TEXT NOT NULL,                    -- <=1500 chars, REWRITTEN not appended
  call_count    INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- pgvector is OPTIONAL. Where the extension is unavailable the embedding column
-- is skipped and retrieval falls back to full-text search — the feature degrades,
-- it does not break.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'vector extension unavailable - keyword fallback';
END $$;

CREATE TABLE IF NOT EXISTS call_recall_docs (
  id            TEXT PRIMARY KEY,                 -- '<kind>:<source_id>[:obs]'
  caller_number TEXT NOT NULL,
  user_id       UUID,
  kind          TEXT NOT NULL,
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ,
  embedded_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_recall_caller ON call_recall_docs (caller_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recall_fts ON call_recall_docs USING gin (to_tsvector('simple', content));

DO $$ BEGIN
  ALTER TABLE call_recall_docs ADD COLUMN IF NOT EXISTS embedding vector(512);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'embedding column skipped (no vector extension)';
END $$;
