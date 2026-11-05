-- ROLLBACK_V1.8.12 — reverse of V1.8.12 region book lists (bd-97daxo.4), Flyway-style rollback applied by migrate.js.
-- destructive: reviewed — drops region_features.book_keys. Its only content is the region book lists that
-- sync-sheet-lps.js --books writes (recreatable from Amena's Books tab with one command). The code reads the column
-- fail-open, so a teacher whose region loses its list gets the ICT menu; roll the code back first all the same.
-- NO BEGIN/COMMIT: migrate.js runs the file as one exec_sql call.

-- destructive: reviewed (see header)
ALTER TABLE region_features DROP COLUMN IF EXISTS book_keys;

NOTIFY pgrst, 'reload schema';
