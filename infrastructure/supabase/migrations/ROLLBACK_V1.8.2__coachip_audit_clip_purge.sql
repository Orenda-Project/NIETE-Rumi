-- ROLLBACK V1.8.2 — coachip_audit_action without 'clip_purge' (reverses V1.8.2__coachip_audit_clip_purge.sql; purge
-- bd-sex15q.36). Postgres cannot drop an enum value, so the type is rebuilt with V1.8.0's five values and the one
-- column that uses it is re-cast.
-- destructive: reviewed — drops only the renamed old type after the column has moved to the rebuilt one. It REFUSES
-- (the cast fails, the one RPC transaction rolls back) once any 'clip_purge' row exists: the audit log is append-only
-- (D20) and its rows are never deleted to make a rollback pass. Then leave V1.8.2 applied; the value is harmless.
-- Roll the code back first: the purge writes the value.
-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control (0A000); the one RPC call is already one transaction.
ALTER TYPE coachip_audit_action RENAME TO coachip_audit_action_v182;
CREATE TYPE coachip_audit_action AS ENUM ('decode', 'clip', 'full_audio', 'note_sent', 'circle_play');
COMMENT ON TYPE coachip_audit_action IS '[Public] what an audited read or send was (D20)';
ALTER TABLE coachip_audit_log ALTER COLUMN action TYPE coachip_audit_action USING action::text::coachip_audit_action;
DROP TYPE coachip_audit_action_v182;
NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--                WHERE t.typname = 'coachip_audit_action' AND e.enumlabel = 'clip_purge';                     -- 0
--              SELECT count(*) FROM pg_type WHERE typname = 'coachip_audit_action_v182';                       -- 0
