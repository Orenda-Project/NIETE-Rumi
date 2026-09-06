-- ---------------------------------------------------------------------------
-- V1.3.2 — join the waiter list ATOMICALLY.
--
-- MEASURED, not theorised. Twenty concurrent taps on one uncached lesson: all twenty were told
-- "already being written — I will send it here as soon as it is ready", and TWO waiters survived.
-- Eighteen teachers were promised a lesson that was never going to arrive. The loss curve is
-- 80 / 90 / 95 / 90 % at N = 5 / 10 / 20 / 40, and it is worst on the most popular lesson —
-- precisely the one a whole staffroom taps at once.
--
-- The cause was a read-modify-write in the service:
--
--     const next = [...list, entry];                       -- `list` read moments earlier
--     UPDATE niete_lp612_renders SET waiters = next ...    -- whole array written back
--
-- Every concurrent caller read the same array, appended itself, and wrote a ONE-element array.
-- Last write wins. Nothing errors and nothing logs, and the ack has already gone out, so the
-- failure is invisible from both sides.
--
-- V1.2.8's own comment predicted this and mis-sized it: "Two teachers joining a waiter list in
-- the same millisecond could have one overwrite the other's entry… Low likelihood, non-silent."
-- It is neither. The measurement is what settled it.
--
-- WHY A FUNCTION AND NOT A WAITERS TABLE. The append has to happen in ONE statement so the row
-- lock serialises concurrent writers and each re-reads `waiters` while holding it. `waiters || x`
-- does that; PostgREST cannot express a self-referencing column update, so it needs a function.
-- A separate table would also work, but the column's original justification still holds — the
-- list is bounded, consumed and cleared on delivery, and has no life of its own to query. What
-- was wrong was the APPEND MECHANISM, not the storage (Rule 15: a table is the last resort).
--
-- IT ALSO CLOSES A SECOND RACE NOBODY HAD NAMED. The render can finish between the caller's read
-- and its append. The worker clears `waiters` when it delivers, so a waiter appended a moment
-- later is attached to a run that is already over — and that teacher waits for ever. The guard
-- `AND status = 'authoring'` refuses that append and the return value says so, so the caller can
-- serve the finished lesson instead of joining a corpse.
-- ---------------------------------------------------------------------------

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

COMMENT ON FUNCTION lp612_join_waiters(UUID, JSONB) IS
  'Atomically append one waiter to niete_lp612_renders.waiters. Returns joined | duplicate | not_authoring | missing. Replaces a client-side read-modify-write that dropped 90% of waiters in a 20-way stampede.';
