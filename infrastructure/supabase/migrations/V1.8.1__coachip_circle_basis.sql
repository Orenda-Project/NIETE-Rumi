-- V1.8.1 — coachip_circle_items.basis: which ranking chose a circle moment (epic bd-sex15q; fix-r5 bd-sex15q.19;
-- SPEC v2.1 §11.1). Flyway-style versioned migration (D8), additive only. Applied to sandbox (olvritwoqujtjvwfulbh)
-- by the lander through MigrationRunner.applyMigration (SPEC §11.4); never to prod without the operator's go.
-- Rollback: ROLLBACK_V1.8.1__coachip_circle_basis.sql. Requires V1.8.0 (the table it alters).
--
-- WHAT. One enum type and one NOT NULL column on the V1.8.0 circle table. 'sector' = the row is the coach's moment on
-- the sector's rank-1 W (every row V1.8.0 could write, hence the default); 'coach' = the sector had no rank-1 W that
-- week (under a B23 floor, or the ranking held), so the circle stage took the moment on the coach's own rank-1 W.
-- WHY STORED, NOT DERIVED (§11.1 rule 2). "The first choice in the week stands" (lib/insights/job.js): a 'coach' row
-- written on Monday stays even if a later run lifts the sector over the floor, so the basis cannot be recomputed from
-- the rollups at read time. WHY A COLUMN, NOT A TABLE (root rule 15): it is one attribute of an existing row.
-- DATA CLASSIFICATION (D6): '[Internal]', as every other coachip_circle_items column. No person data.
-- OWNER (D7): COACHIP / m-insights (bd-sex15q.14), written by fix-r5. STEWARD: as V1.8.0.
-- IDEMPOTENT: guarded CREATE TYPE, ADD COLUMN IF NOT EXISTS. ORDER: safe before the code (the default keeps every
-- existing writer and reader valid; the new code writes 'coach' only once this has applied).
-- Proven with scripts/migration_gate.sh (one exec_sql call per file, applied twice, rollback, re-apply).

-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control (0A000); the one RPC call is already one transaction.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coachip_circle_basis') THEN
    CREATE TYPE coachip_circle_basis AS ENUM ('sector', 'coach');
  END IF;
END $$;
COMMENT ON TYPE coachip_circle_basis IS '[Public] which ranking chose a circle moment: sector = the sector''s rank-1 W; coach = the coach''s own rank-1 W, the sector being under the B23 floor (SPEC v2.1 §11.1)';

ALTER TABLE coachip_circle_items ADD COLUMN IF NOT EXISTS basis coachip_circle_basis NOT NULL DEFAULT 'sector';
COMMENT ON COLUMN coachip_circle_items.basis IS '[Internal] which ranking chose the moment: sector = the sector''s rank-1 W; coach = the coach''s own rank-1 W because the sector was under the B23 floor (SPEC v2.1 §11.1)';

NOTIFY pgrst, 'reload schema';

-- ── post-flight (expect these exactly on a fresh apply over V1.8.0) ───────────────────────────────────────────
--   SELECT count(*) FROM pg_type WHERE typname LIKE 'coachip\_%' AND typtype = 'e';          -- 26
--   SELECT data_type, udt_name, is_nullable, column_default FROM information_schema.columns
--     WHERE table_name = 'coachip_circle_items' AND column_name = 'basis';
--     -- USER-DEFINED | coachip_circle_basis | NO | 'sector'::coachip_circle_basis
--   SELECT count(*) FROM coachip_circle_items WHERE basis <> 'sector';                        -- 0
