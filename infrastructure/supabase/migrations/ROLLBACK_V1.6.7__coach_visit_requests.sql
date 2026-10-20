-- ROLLBACK V1.6.7 — coach_visit_requests (reverses migration V1.6.7).
-- destructive: reviewed — drops only what V1.6.7 added: the request table.
-- Run after the test is promoted, or to abandon it. Export the table first if the tracker's final
-- numbers have not been taken from it.
BEGIN;
DROP TABLE IF EXISTS coach_visit_requests;
COMMIT;
