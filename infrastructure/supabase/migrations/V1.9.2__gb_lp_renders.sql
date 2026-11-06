-- V1.9.2 — GB's own lesson-plan cache: niete_gb_lp_renders + its two waiter RPCs (bd-rj6w0n.14.16).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. GB (nbf_snc) lesson plans are authored at runtime like 6-12's, but in their OWN lane: their own
-- cache rows (this table), their own R2 prefix (gb-lp/), their own job (gb_lp_author). A GB lesson is never
-- served from or written into niete_lp612_renders, and an ICT lesson never lands here. The segment catalog
-- (niete_lp612_segments) stays shared; GB rows there carry curriculum 'nbf_snc'.
--
-- DATA CLASSIFICATION (D6): '[Internal]' — render bookkeeping; waiters hold a phone + user id while a run is
-- in flight and are emptied when it ends (same as niete_lp612_renders).
-- OWNER (D7): NIETE-Rumi platform (bd-rj6w0n.14).
-- DATA. New empty table. LOAD. One row per (GB lesson, language, template). SECURITY. Service role only (RLS on,
-- no policies), like the 6-12 render table's server-only use.
-- IDEMPOTENT. IF NOT EXISTS / CREATE OR REPLACE throughout.
-- Rollback: ROLLBACK_V1.9.2__gb_lp_renders.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS niete_gb_lp_renders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id        TEXT NOT NULL REFERENCES niete_lp612_segments(segment_id),
  lang              TEXT NOT NULL CHECK (lang IN ('en', 'ur')),
  template_version  TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'authoring' CHECK (status IN ('authoring', 'ready', 'failed')),
  r2_key            TEXT CHECK (r2_key IS NULL OR r2_key LIKE 'gb-lp/%'),
  page_count        INTEGER,
  model_used        TEXT,
  lint_clean        BOOLEAN,
  lint_fails        JSONB,
  timings           JSONB,
  error_code        TEXT,
  error_detail      TEXT,
  waiters           JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_by      UUID REFERENCES users(id),
  correlation_id    TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  picked_up_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT niete_gb_lp_renders_key UNIQUE (segment_id, lang, template_version)
);

CREATE INDEX IF NOT EXISTS idx_gb_lp_renders_inflight
  ON niete_gb_lp_renders (status, started_at) WHERE status = 'authoring';

ALTER TABLE niete_gb_lp_renders ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE niete_gb_lp_renders IS
  'GB (nbf_snc) runtime lesson plans: one row per (segment, lang, template_version). r2_key is always under gb-lp/. Never mixed with niete_lp612_renders.';

-- Same contract as lp612_join_waiters (V1.3.2): joined | duplicate | not_authoring | missing.
CREATE OR REPLACE FUNCTION gb_lp_join_waiters(p_render_id UUID, p_entry JSONB)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INTEGER;
  v_status  TEXT;
BEGIN
  UPDATE niete_gb_lp_renders
     SET waiters    = waiters || jsonb_build_array(p_entry),
         updated_at = NOW()
   WHERE id = p_render_id
     AND status = 'authoring'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(waiters) AS w
        WHERE w->>'phone' IS NOT DISTINCT FROM p_entry->>'phone'
     );
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN RETURN 'joined'; END IF;
  SELECT status INTO v_status FROM niete_gb_lp_renders WHERE id = p_render_id;
  IF v_status IS NULL        THEN RETURN 'missing';       END IF;
  IF v_status <> 'authoring' THEN RETURN 'not_authoring'; END IF;
  RETURN 'duplicate';
END;
$$;

-- Same contract as lp612_claim_waiters (V1.3.4): call AFTER the terminal status is written.
CREATE OR REPLACE FUNCTION gb_lp_claim_waiters(p_render_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_waiters JSONB;
BEGIN
  SELECT waiters INTO v_waiters FROM niete_gb_lp_renders WHERE id = p_render_id FOR UPDATE;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  UPDATE niete_gb_lp_renders SET waiters = '[]'::jsonb, updated_at = NOW() WHERE id = p_render_id;
  RETURN COALESCE(v_waiters, '[]'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT count(*) FROM niete_gb_lp_renders;  -- 0
