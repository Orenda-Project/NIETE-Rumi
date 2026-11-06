-- ROLLBACK_V1.8.11 — reverse of V1.8.11 textbooks.meta (bd-5jmnfj.38), Flyway-style rollback applied by migrate.js.
-- destructive: reviewed — drops only the provenance column. Pages, TOC and textbooks rows are untouched; the next
-- corpus import would then re-write every book (no stored hash) and fail on the PATCH until V1.8.11 is re-applied.
-- NO BEGIN/COMMIT: migrate.js runs the file as one exec_sql call.

-- destructive: reviewed (see header)
ALTER TABLE public.textbooks DROP COLUMN IF EXISTS meta;
