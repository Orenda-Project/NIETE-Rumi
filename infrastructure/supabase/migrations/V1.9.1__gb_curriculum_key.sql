-- V1.9.1 — Gilgit-Baltistan's curriculum_key is 'nbf_snc' on every database (bd-rj6w0n.14.15).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. V1.8.6 renames GB's key 'gb' -> 'nbf_snc', but the GB registry row is inserted by V1.8.8, with 'gb'. Where
-- the registry row already existed (sandbox), V1.8.6 renamed it. Applied in order on a fresh database or production,
-- V1.8.6 matches nothing and GB stays on 'gb', so its teachers get ICT's books. This re-applies the same rename after
-- both. V1.8.6 and V1.8.8 are applied on sandbox and are not edited.
--
-- DATA CLASSIFICATION (D6): '[Internal]' — region configuration, no person data.
-- OWNER (D7): NIETE-Rumi platform (bd-rj6w0n.14).
-- DATA. At most one region_features row. LOAD. Negligible. SECURITY. Unchanged.
-- IDEMPOTENT. The UPDATE matches only a row still on 'gb'.
-- Rollback: ROLLBACK_V1.9.1__gb_curriculum_key.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

UPDATE region_features SET curriculum_key = 'nbf_snc', updated_at = now()
 WHERE region = 'gilgit-baltistan' AND curriculum_key = 'gb';

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT region, curriculum_key FROM region_features WHERE region = 'gilgit-baltistan';  -- nbf_snc
