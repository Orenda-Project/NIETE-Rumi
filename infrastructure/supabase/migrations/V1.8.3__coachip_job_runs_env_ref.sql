-- V1.8.3 — coachip_job_runs.env_ref accepts the three project refs the nightly asserts (epic bd-sex15q; bd-sex15q.38).
-- Flyway-style versioned migration (D8). Applied to sandbox (olvritwoqujtjvwfulbh), then staging (rpqkekcfvumypldbejhp),
-- through MigrationRunner.applyMigration ALONE (SPEC §11.4); to prod (ihzciabopbttygxxgrkm) only with the operator's go.
-- Rollback: ROLLBACK_V1.8.3__coachip_job_runs_env_ref.sql. Requires V1.8.0 (the table and the constraint it replaces).
--
-- WHY. The job writes env_ref = the Supabase project ref that lib/insights/env.js asserted (job.js, the run-row upsert).
-- V1.8.0 listed ('olvritwoqujtjvwfulbh','staging','production'): the sandbox REF beside two placeholder WORDS written
-- before the staging and prod refs were known. The run row is the job's first write, so on staging every run stopped
-- there with 23514 and wrote nothing (hand run 27 Oct 2026, board 20261027T183227); prod would have done the same.
-- The list is now constants.js SANDBOX_REF, STAGING_REF and PROD_REF, nothing else.
-- WHY A CONSTRAINT SWAP, NOT A NEW COLUMN OR TABLE (root rule 15). The column already is the run's tier; only its
-- domain was wrong. No row can hold a placeholder word: no run has ever been recorded off sandbox (the CHECK refused it).
-- DATA CLASSIFICATION (D6): '[Internal]', as the column. No person data.
-- OWNER (D7): COACHIP / m-insights (bd-sex15q.14). STEWARD: as V1.8.0.
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS, then ADD. ORDER: safe before or after the code (the code is unchanged).
-- Proven with scripts/migration_gate.sh (one exec_sql call per file, applied twice, rollback, re-apply).

-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control (0A000); the one RPC call is already one transaction.

ALTER TABLE coachip_job_runs DROP CONSTRAINT IF EXISTS coachip_job_runs_env_ref_check;
ALTER TABLE coachip_job_runs ADD CONSTRAINT coachip_job_runs_env_ref_check
  CHECK (env_ref IN ('olvritwoqujtjvwfulbh', 'rpqkekcfvumypldbejhp', 'ihzciabopbttygxxgrkm'));

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'coachip_job_runs_env_ref_check';
--              -- CHECK ((env_ref = ANY (ARRAY['olvritwoqujtjvwfulbh'::text, 'rpqkekcfvumypldbejhp'::text, 'ihzciabopbttygxxgrkm'::text])))
