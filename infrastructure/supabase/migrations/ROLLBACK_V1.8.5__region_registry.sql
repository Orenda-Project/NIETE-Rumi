-- ROLLBACK_V1.8.5 — reverse of V1.8.5 region registry (bd-97daxo.2), Flyway-style rollback applied by migrate.js.
-- destructive: reviewed — drops the four registry columns and the rows V1.8.5 created. Nothing else is lost: a sector
-- row that existed before V1.8.5 keeps its LP columns (V1.8.5 never changed them). Roll the CODE back first, because
-- region-registry.js selects these columns and fails closed without them.
-- NO BEGIN/COMMIT: migrate.js runs the file as one exec_sql call.

DELETE FROM region_features WHERE region = 'gilgit-baltistan' AND organization = 'moawin';
DELETE FROM region_features
 WHERE region IN ('b.k', 'sihala', 'urban-i', 'nilore', 'urban-ii', 'tarnol')
   AND organization = 'niete'
   AND curriculum_key IS NULL AND curriculum_lp_enabled = false;

-- destructive: reviewed (see header)
ALTER TABLE region_features DROP COLUMN IF EXISTS is_active;
-- destructive: reviewed (see header)
ALTER TABLE region_features DROP COLUMN IF EXISTS sort_order;
-- destructive: reviewed (see header)
ALTER TABLE region_features DROP COLUMN IF EXISTS display_name;
-- destructive: reviewed (see header)
ALTER TABLE region_features DROP COLUMN IF EXISTS organization;

NOTIFY pgrst, 'reload schema';
