-- V1.10.2 — schools.district: a school's district, so a region can be split into areas on the dashboard
-- (bd-97daxo.33). Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHY. Moawin (Gilgit-Baltistan) needs Gilgit and Baltistan side by side on its analytics view: Baltistan is in exams
-- (ECCE to grade 8) and the two areas are run apart. NIETE stores no district today. The column holds the REAL
-- district (Skardu, Shigar, Gilgit, Diamer ...); which area a district belongs to is data in the dashboard
-- (dashboard/config/gb-areas.json), not a column (operator, 17 Nov). schools.region is NOT touched: access and the
-- bot's GB settings read it.
-- DATA CLASSIFICATION (D6): '[Internal]' — a school's district, public administrative geography; no person, no contact.
-- OWNER (D7): NIETE-Rumi platform. Written by scripts/load-school-districts.js (dry run by default, undo file).
-- DATA. Existing rows: NULL (no district on record). LOAD. One UPDATE per GB school from scripts/data/gb-school-districts.csv.
-- SECURITY. Unchanged (RLS on schools as before; the column adds no policy).
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS. Rollback: ROLLBACK_V1.10.2__schools_district.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE schools ADD COLUMN IF NOT EXISTS district TEXT;

COMMENT ON COLUMN schools.district IS '[Internal] The school''s district as its programme records it (e.g. Skardu, Gilgit). NULL = not on record. The dashboard groups districts into areas from dashboard/config/gb-areas.json; access never reads it (schools.region does). bd-97daxo.33.';

NOTIFY pgrst, 'reload schema';
