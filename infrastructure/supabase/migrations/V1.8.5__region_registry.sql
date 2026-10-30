-- V1.8.5 — region registry: region_features names each region, its owner, and its dashboard order (bd-97daxo.2).
-- Flyway-style versioned migration (D8). Applied to sandbox (olvritwoqujtjvwfulbh), then staging (rpqkekcfvumypldbejhp),
-- through MigrationRunner.applyMigration ALONE; to prod (ihzciabopbttygxxgrkm) only with the operator's go.
-- Rollback: ROLLBACK_V1.8.5__region_registry.sql.
--
-- WHY. Gilgit-Baltistan joins NIETE-Rumi as a region owned by Moawin, not FDE. The six ICT sectors were a constant
-- copied into ~10 files; FDE's dashboards must keep showing exactly those six, and a Moawin dashboard must show only
-- GB. The owner and the list become data: organization (the users.organization value of the region's teachers:
-- 'niete' for FDE's sectors, 'moawin' for GB), display_name (as schools.region / users.region spell it), sort_order
-- (the order the dashboards already list them in), is_active.
-- WHY COLUMNS ON region_features, NOT A TABLE (root rule 15). region_features is already "one row per region" and
-- region-features.service.js already reads it by users.region; a second regions table would hold the same key.
-- BEHAVIOUR. A sector row that does not exist yet is created with the table defaults, which equal
-- DEFAULT_REGION_FEATURES in region-features.service.js — the features a sector user already gets today from the
-- missing-row fallback. So no LP path changes. A row that already exists keeps every LP column (ON CONFLICT touches
-- only the four registry columns). GB: curriculum_key 'gb' (its books, once loaded; ICT's until then) and
-- pic_lp_enabled false (operator, 2026-10-29: pic-to-LP is dropped for GB).
-- DATA CLASSIFICATION (D6): '[Internal]' — region configuration, no person data.
-- OWNER (D7): NIETE-Rumi platform (bd-97daxo). STEWARD: Hataf Atif.
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS; upserts. ORDER: before the code (the registry reads these columns).

-- NO BEGIN/COMMIT: migrate.js sends this file to rpc/exec_sql (a plpgsql EXECUTE), which refuses transaction control (0A000); the one RPC call is already one transaction.

ALTER TABLE region_features ADD COLUMN IF NOT EXISTS organization TEXT;
ALTER TABLE region_features ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE region_features ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE region_features ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN region_features.organization IS
  'Owner of the region = users.organization of its teachers (niete = FDE''s ICT sectors, moawin = Gilgit-Baltistan). NULL = not a region (deployment-wide row). Dashboards show an account only its organization''s regions.';
COMMENT ON COLUMN region_features.display_name IS
  'The region as schools.region and users.region spell it (e.g. Sihala, Gilgit-Baltistan). region (the key) is its lower case.';

INSERT INTO region_features (region, organization, display_name, sort_order) VALUES
  ('b.k', 'niete', 'B.K', 1),
  ('sihala', 'niete', 'Sihala', 2),
  ('urban-i', 'niete', 'Urban-I', 3),
  ('nilore', 'niete', 'Nilore', 4),
  ('urban-ii', 'niete', 'Urban-II', 5),
  ('tarnol', 'niete', 'Tarnol', 6)
ON CONFLICT (region) DO UPDATE SET
  organization = EXCLUDED.organization,
  display_name = EXCLUDED.display_name,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO region_features (region, organization, display_name, sort_order, curriculum_key, pic_lp_enabled)
VALUES ('gilgit-baltistan', 'moawin', 'Gilgit-Baltistan', 1, 'gb', false)
ON CONFLICT (region) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT region, organization, display_name, sort_order, is_active, curriculum_key, pic_lp_enabled
--              FROM region_features ORDER BY organization NULLS FIRST, sort_order;
--              -- niete row unchanged (organization NULL); six niete sectors 1..6; gilgit-baltistan moawin 1, gb, f
