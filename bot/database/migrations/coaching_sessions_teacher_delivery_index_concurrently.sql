-- The untapped and undelivered report sweeps (workers/stale-session.worker.js readUntappedCandidates,
-- readUndeliveredCandidates) filter leader observations on analysis_data->teacher_delivery->>status, and the
-- no-record lane on analysis_data->teacher_delivery IS NULL. With no index on those paths every read unpacked the
-- ~62 KB analysis_data of every finished leader observation (6,701 on prod, 27 Nov): ~1.8 s a read when warm, and
-- past the API statement time limit PostgREST cancels it. niete-logs env==production: 'undelivered sweep: query
-- failed' 59-117 a day (awaiting_confirm + previewing lanes) and 'untapped sweep: query failed' 45-107 a day since
-- 15 Nov, all 'canceling statement due to statement timeout'; reports stuck at awaiting_confirm / previewing were
-- never reminded or closed. bd-tfya0m.2.
--
-- 1. The status lanes (awaiting_confirm, previewing, awaiting_teacher_tap): an expression index whose leading
--    column is the status PostgREST builds from the filter path, then updated_at, id (the undelivered sweep's
--    order). Partial on leader observations that HAVE a status, so it holds only the observations the sweeps read
--    (an equality filter implies NOT NULL, so the planner still uses it).
-- 2. The no-record lane: a partial index on exactly its IS NULL, ordered the way the sweep reads it.
-- bot/tests/workers/teacher-delivery-index.test.js ties both to the sweeps' filters: change a filter path and the
-- test fails before the index silently stops matching.
--
-- coaching_sessions is live: run OUTSIDE a transaction (psql without BEGIN; not a migration wrapper that opens
-- one), one statement at a time. Additive only: no table, column or row changes.

-- migrate:up
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_coaching_sessions_leader_delivery_status ON public.coaching_sessions ((((analysis_data -> 'teacher_delivery') ->> 'status')), updated_at, id) WHERE observation_type = 'leader_observation' AND ((analysis_data -> 'teacher_delivery') ->> 'status') IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_coaching_sessions_leader_no_delivery ON public.coaching_sessions (updated_at, id) WHERE observation_type = 'leader_observation' AND (analysis_data -> 'teacher_delivery') IS NULL;

-- migrate:down
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_coaching_sessions_leader_delivery_status;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_coaching_sessions_leader_no_delivery;
