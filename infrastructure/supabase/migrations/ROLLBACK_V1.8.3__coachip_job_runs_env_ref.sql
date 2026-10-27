-- ROLLBACK V1.8.3 — coachip_job_runs.env_ref back to V1.8.0's list (reverses V1.8.3__coachip_job_runs_env_ref.sql;
-- bd-sex15q.38). It REFUSES (23514, the one RPC transaction rolls back) once a staging or prod run row exists: run rows
-- are the job's own operational log and are not deleted to make a rollback pass. Then leave V1.8.3 applied.
-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control (0A000); the one RPC call is already one transaction.
ALTER TABLE coachip_job_runs DROP CONSTRAINT IF EXISTS coachip_job_runs_env_ref_check;
ALTER TABLE coachip_job_runs ADD CONSTRAINT coachip_job_runs_env_ref_check
  CHECK (env_ref IN ('olvritwoqujtjvwfulbh', 'staging', 'production'));
NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'coachip_job_runs_env_ref_check';
--              -- CHECK ((env_ref = ANY (ARRAY['olvritwoqujtjvwfulbh'::text, 'staging'::text, 'production'::text])))
