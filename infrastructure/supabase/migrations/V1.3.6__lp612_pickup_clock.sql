-- V1.3.6 — the render lifecycle stops lying about itself.
--
-- bd-dr216 / bd-w36m5 / bd-7yxsu. One column, and two data repairs.
--
-- THE PROBLEM. `niete_lp612_renders` had ONE clock where it needed two. `started_at` is written by
-- the INSERT's own `DEFAULT NOW()` (and re-written by the retry compare-and-swap), so it records
-- when the TEACHER ASKED — when the job was enqueued. Nothing recorded when a worker actually
-- began. `reapStrandedRenders()` measured staleness from `started_at` and wrote
-- status='failed', error_code='AUTHOR_STRANDED' at LP612_AUTHOR_TIMEOUT_MS + 3 min, so:
--
--   * a job still WAITING in the SQS queue was condemned at ~17 minutes before any worker had
--     touched it (confirmed live 2026-09-04 07:42, 2 of 16 coach taps), on a lane whose measured
--     p90 enqueue->done is 1023s — i.e. ordinary queue wait crossed the threshold by itself; and
--   * a job a worker was LEGITIMATELY still authoring was condemned too, because the SQS message
--     was validly in flight the whole time (900s visibility, re-extended every 60s by the bd-awqt3
--     heartbeat up to 2x the job's own hard timeout). Those rows flipped `failed` and then back to
--     `ready` when the worker finished — observed the same day as the failed count fell 20->15
--     while ready climbed.
--
-- ANTI-SPRAWL (rule 15). No existing column can hold this. `started_at` cannot: the retry CAS
-- guards on it and the partial in-flight index is built on it, and both need it to keep meaning
-- "when this attempt was requested". `updated_at` cannot: it is a generic mtime that four different
-- write paths bump, so overloading it would let any future write silently reset the authoring
-- clock. It cannot be computed, either — pickup is an event only the worker observes and nothing
-- else in the schema witnesses it. The considered alternative was a new `queued` status value, and
-- it was rejected as strictly larger: it would change the CHECK constraint, both waiter RPCs' hard
-- `status = 'authoring'` guards, the worker's idempotency check and the serving decision, for the
-- same information one nullable timestamp carries. NO new index: the reaper now selects `WHERE
-- status = 'authoring'` and classifies in JS, which the existing partial index already serves.

ALTER TABLE niete_lp612_renders
  ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;

COMMENT ON COLUMN niete_lp612_renders.picked_up_at IS
  'When a worker actually took this job off the queue. NULL means queued and not yet attempted. Staleness for the stranded-render sweep is measured from HERE, never from started_at (which is enqueue time) -- see bd-dr216.';

-- Backfill the rows that are in flight RIGHT NOW.
--
-- Without this, every `authoring` row that exists at deploy time reads as never-picked-up and would
-- be judged on the six-hour queue-abandonment backstop instead of the authoring clock -- including
-- the genuinely stranded ones a deploy left behind, which is the case the reaper was built for.
-- `started_at` is the best evidence available for those rows and it is a bounded, one-time set.
-- New rows get a true pickup stamp from the worker.
UPDATE niete_lp612_renders
   SET picked_up_at = started_at
 WHERE status = 'authoring'
   AND picked_up_at IS NULL;

-- bd-7yxsu — a delivered lesson that reads as errored.
--
-- The worker's success patch wrote status='ready' and never named `error_code`, and an UPDATE that
-- does not name a column leaves whatever is in it. So a row the reaper had (wrongly) failed, and
-- which then finished normally, came out as status='ready' with error_code='AUTHOR_STRANDED' -- e.g.
-- grade_11_physics.c01.p014-018. EVERY FAILURE COUNT QUOTED ON 2026-09-04 IS INFLATED BY THIS,
-- including the ones in HANDOFF_feat080_2026-09-04.md.
--
-- The code fix (naming both columns in the success patch) stops new ones. This clears the ones
-- already on the table. Scoped to `ready` only: a `failed` row's error code is the truth about it.
UPDATE niete_lp612_renders
   SET error_code   = NULL,
       error_detail = NULL,
       updated_at   = NOW()
 WHERE status = 'ready'
   AND error_code IS NOT NULL;

NOTIFY pgrst, 'reload schema';
