-- ---------------------------------------------------------------------------
-- V1.3.4 — claim the waiter list ATOMICALLY, at the END of the job.
--
-- V1.3.2 made the APPEND atomic and proved it: twenty concurrent taps, twenty waiters recorded.
-- The drop then moved one step downstream, where nobody was looking.
--
-- The authoring worker read its audience at the TOP of the job:
--
--     const render  = await loadRender(renderId);   -- t = 0
--     const waiters = waitersOf(render);            -- a SNAPSHOT
--     ... author, render, upload ...                -- t = 2 to 10 MINUTES
--     await patch(renderId, { ..., waiters: [] });  -- the real list, erased
--     for (const w of waiters) deliver(w);          -- the snapshot, delivered
--
-- So every teacher who tapped that lesson while it was being written was appended correctly by
-- lp612_join_waiters, never read, and then deleted. The window is the whole authoring run, which
-- is precisely the window in which a staffroom taps the same lesson — one teacher shares it,
-- five more tap it in the next ninety seconds, and exactly one of them gets a lesson.
--
-- WHY A FUNCTION. Reading the list and clearing it are ONE decision: whoever is on the row at the
-- moment of the clear is exactly the set that must be delivered to. Split across two statements
-- there is a gap, and a teacher who joins inside it is cleared without ever being read — the same
-- lost-update shape V1.3.2 fixed for the append, one step later in the pipeline. PostgREST cannot
-- express read-then-clear as a single request, so it needs a function.
--
-- HOW IT IS ATOMIC. The SELECT ... FOR UPDATE takes the row lock, and it is still held when the
-- UPDATE empties the list, because a function body runs in one transaction. lp612_join_waiters is
-- a single UPDATE on the same row, so a concurrent append BLOCKS on that lock and only proceeds
-- once this has committed — at which point its own `AND status = 'authoring'` guard decides the
-- outcome. That guard is why the caller flips the row to `ready`/`failed` BEFORE calling this:
--
--   join lands BEFORE the status flip  -> appended, and returned by this claim -> delivered
--   join lands AFTER  the status flip  -> refused with 'not_authoring'         -> the serving
--                                          path re-decides her into a cache hit off the row that
--                                          was just marked ready
--
-- There is no third case, so there is no window. The ordering is the guarantee, and it is
-- asserted in tests/lp612/author-worker.test.js.
--
-- NO NEW COLUMN AND NO NEW TABLE (Rule 15). This is a new ACCESS PATH to an existing column.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lp612_claim_waiters(p_render_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_waiters JSONB;
BEGIN
  -- Take the row lock FIRST and read under it. A concurrent lp612_join_waiters() blocks here
  -- until this transaction commits, so no append can slip between the read and the clear.
  SELECT waiters INTO v_waiters
    FROM niete_lp612_renders
   WHERE id = p_render_id
     FOR UPDATE;

  -- A render row deleted under a running job is not an error worth throwing: the job has nothing
  -- to deliver to and the caller must not crash on the way to saying so.
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  UPDATE niete_lp612_renders
     SET waiters    = '[]'::jsonb,
         updated_at = NOW()
   WHERE id = p_render_id;

  -- The list as it stood the instant before it was emptied. This is the delivery audience.
  RETURN COALESCE(v_waiters, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION lp612_claim_waiters(UUID) IS
  'Atomically return niete_lp612_renders.waiters and empty it, under one row lock. The delivery audience for a finished (or failed) authoring run. Call it AFTER writing the terminal status, so a concurrent lp612_join_waiters is either included here or refused with not_authoring.';

NOTIFY pgrst, 'reload schema';
