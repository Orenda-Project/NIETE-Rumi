-- bd-2gia5l — rename the partner training programmes (NIETE, 2026-10-13).
--
-- training_vendors.name is the name teachers see: the portal shows the
-- server's vendor_name wherever it has one, and falls back to the same names
-- in portal/src/portal/newui/training/trainingApi.ts (PROVIDERS) where it has
-- none. Keep the two in step. The vendor KEYS do not change: certificates,
-- scopes and code all key on them.
--
-- Idempotent: re-running changes nothing.
BEGIN;

UPDATE training_vendors
   SET name = 'Smart Schools Project: Game-Based Teaching, Learning and Assessment (GBTLA), 6-10'
 WHERE key = 'OXBRIDGE'
   AND name IS DISTINCT FROM 'Smart Schools Project: Game-Based Teaching, Learning and Assessment (GBTLA), 6-10';

UPDATE training_vendors
   SET name = 'AI-Powered Subject Pedagogy, 6-10'
 WHERE key = 'BEACONHOUSE'
   AND name IS DISTINCT FROM 'AI-Powered Subject Pedagogy, 6-10';

UPDATE training_vendors
   SET name = 'Teacher Development Programme, 9-12'
 WHERE key = 'ISAPS'
   AND name IS DISTINCT FROM 'Teacher Development Programme, 9-12';

COMMIT;

-- Rollback (the names before this migration):
--   UPDATE training_vendors SET name = 'Oxbridge'     WHERE key = 'OXBRIDGE';
--   UPDATE training_vendors SET name = 'Beacon House' WHERE key = 'BEACONHOUSE';
--   UPDATE training_vendors SET name = 'I-SAPS'       WHERE key = 'ISAPS';
