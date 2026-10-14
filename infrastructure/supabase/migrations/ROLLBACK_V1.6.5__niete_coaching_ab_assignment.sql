-- ROLLBACK V1.6.5 — niete_coaching_ab_assignment (reverses migration V1.6.5).
-- destructive: reviewed — drops only what V1.6.5 added: the assignment table and its switch row.
-- Run after the test is promoted, or to abandon it. Export the table first if the results
-- script has not yet been run against it.
BEGIN;
DELETE FROM app_settings WHERE key = 'ab_v10_enabled';
DROP TABLE IF EXISTS niete_coaching_ab_assignment;
COMMIT;
