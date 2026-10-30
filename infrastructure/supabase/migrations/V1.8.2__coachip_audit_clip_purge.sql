-- V1.8.2 — coachip_audit_action gains 'clip_purge': one audit row per retention purge run (epic bd-sex15q; purge
-- bd-sex15q.36; NIGHTLY_JOB §10, INSIGHTS_SCHEMA §4, PENDING item 7 default A). Flyway-style versioned migration (D8),
-- additive only. Applied to sandbox (olvritwoqujtjvwfulbh) by the lander through MigrationRunner.applyMigration
-- (SPEC §11.4); never to prod without the operator's go. Rollback: ROLLBACK_V1.8.2__coachip_audit_clip_purge.sql.
-- Requires V1.8.0 (the type it extends).
--
-- WHAT. One value on an existing enum. `--purge-clips` (dashboard/lib/insights/purge.js) deletes R2 clips and
-- whole-lesson MP3s 8 weeks after their last window closed and writes one coachip_audit_log row per run:
-- actor = the staff user named by COACHIP_PURGE_ACTOR_USER_ID, action = 'clip_purge', subject = the purge run's id
-- (the run's counts are in the job log under that id, never a key or a session id).
-- WHY A VALUE, NOT A TABLE OR COLUMN (root rule 15). The audit log already is the append-only record of who did what
-- to which subject (D20); a destructive run is exactly such an act, and none of the five V1.8.0 actions names it.
-- DATA CLASSIFICATION (D6): '[Public]', as the type's other values. No person data.
-- OWNER (D7): COACHIP / m-insights (bd-sex15q.14), written by purge. STEWARD: as V1.8.0.
-- IDEMPOTENT: ADD VALUE IF NOT EXISTS. ORDER: safe before the code (no reader or writer depends on the value's
-- absence; the purge writes it only once this has applied).
-- Proven with scripts/migration_gate.sh (one exec_sql call per file, applied twice, rollback, re-apply).

-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control (0A000); the one RPC call is already one transaction.

ALTER TYPE coachip_audit_action ADD VALUE IF NOT EXISTS 'clip_purge';
COMMENT ON TYPE coachip_audit_action IS '[Public] what an audited read, send or purge was (D20); clip_purge = one retention purge run (subject = the run id)';

NOTIFY pgrst, 'reload schema';
