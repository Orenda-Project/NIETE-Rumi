-- V1.10.0 — lp612_join_waiters: a second PORTAL teacher on one in-flight render is appended (bd-2ibyoi).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. V1.3.2 de-duplicated waiters on phone with IS NOT DISTINCT FROM. Portal waiters carry phone NULL, and
-- NULL IS NOT DISTINCT FROM NULL is true, so the second portal teacher waiting on the same G6-12 render was
-- answered 'duplicate', told "joined" by the portal, and never appended: no claim row, the lesson never came.
-- NOW. A waiter WITH a phone is de-duplicated on phone (unchanged: tapping twice is one WhatsApp delivery).
-- A waiter WITHOUT a phone is de-duplicated on (user_id, surface). A teacher waiting on WhatsApp and in the
-- portal is two entries, as the worker delivers per surface.
-- DATA. No table change; existing waiters lists are untouched. SECURITY. Unchanged.
-- IDEMPOTENT. CREATE OR REPLACE. Rollback: ROLLBACK_V1.10.0__lp612_join_waiters_portal_dedupe.sql (V1.3.2 body).
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.
CREATE OR REPLACE FUNCTION lp612_join_waiters(p_render_id UUID, p_entry JSONB)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INTEGER;
  v_status  TEXT;
BEGIN
  -- ONE statement. The row lock serialises concurrent callers and `waiters` is re-read under it,
  -- so an append can never be computed from a stale copy.
  UPDATE niete_lp612_renders
     SET waiters    = waiters || jsonb_build_array(p_entry),
         updated_at = NOW()
   WHERE id = p_render_id
     AND status = 'authoring'
     -- Tapping twice must not mean being sent the lesson twice. With a phone, de-duplicate on phone
     -- (what WhatsApp delivery uses). Without one (portal), on (user_id, surface): phone NULL must never
     -- match another phone NULL, or every portal teacher after the first is silently dropped (bd-2ibyoi).
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(waiters) AS w
        WHERE CASE
                WHEN p_entry->>'phone' IS NOT NULL THEN w->>'phone' = p_entry->>'phone'
                ELSE w->>'phone' IS NULL
                 AND w->>'user_id' IS NOT DISTINCT FROM p_entry->>'user_id'
                 AND COALESCE(w->>'surface', 'whatsapp') = COALESCE(p_entry->>'surface', 'whatsapp')
              END
     );
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    RETURN 'joined';
  END IF;
  SELECT status INTO v_status FROM niete_lp612_renders WHERE id = p_render_id;
  IF v_status IS NULL       THEN RETURN 'missing';       END IF;
  IF v_status <> 'authoring' THEN RETURN 'not_authoring'; END IF;
  RETURN 'duplicate';
END;
$$;
