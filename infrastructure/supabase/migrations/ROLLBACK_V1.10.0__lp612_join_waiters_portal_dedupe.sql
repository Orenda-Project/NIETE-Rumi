-- Rollback for V1.10.0 (bd-2ibyoi): restores the V1.3.2 body, which de-duplicates every waiter on phone.
-- Roll back only with the code that relies on it; a second portal waiter on one render is then dropped again.
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
     -- Tapping twice must not mean being sent the lesson twice. Deduped on PHONE, because that is
     -- what delivery actually uses and it is present for every caller; user_id may be null.
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(waiters) AS w
        WHERE w->>'phone' IS NOT DISTINCT FROM p_entry->>'phone'
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
