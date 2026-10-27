-- ROLLBACK V1.8.1 — coachip_circle_items.basis (reverses V1.8.1__coachip_circle_basis.sql; fix-r5 bd-sex15q.19).
-- destructive: reviewed — drops only what V1.8.1 added: the basis column and the coachip_circle_basis type. The
-- 'coach' rows themselves stay (they are valid circle rows; only the label goes). Roll the code back first: the
-- fix-r5 circle stage writes basis and the R20 read selects it.
-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control (0A000); the one RPC call is already one transaction.
ALTER TABLE IF EXISTS coachip_circle_items DROP COLUMN IF EXISTS basis;
DROP TYPE IF EXISTS coachip_circle_basis;
NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT count(*) FROM pg_type WHERE typname = 'coachip_circle_basis';                          -- 0
--              SELECT count(*) FROM information_schema.columns WHERE table_name = 'coachip_circle_items'
--                AND column_name = 'basis';                                                                  -- 0
