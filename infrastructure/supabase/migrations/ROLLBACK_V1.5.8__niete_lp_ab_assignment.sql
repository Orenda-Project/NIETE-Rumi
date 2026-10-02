-- ROLLBACK V1.5.8 — niete_lp_ab_assignment (reverses migration V1.5.8).
-- destructive: reviewed — drops only what V1.5.8 added: the assignment table and its flag row.
-- Run after the test is promoted, or to abandon it. Export the table first if the results
-- script has not yet been run against it.
BEGIN;
DELETE FROM app_settings WHERE key = 'ab_lp_ch310_enabled';
DROP TABLE IF EXISTS niete_lp_ab_assignment;
COMMIT;
