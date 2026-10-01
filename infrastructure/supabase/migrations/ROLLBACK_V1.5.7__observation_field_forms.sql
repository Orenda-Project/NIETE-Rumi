-- Reverse of V1.5.7. A new table, so the reverse removes it — and with it every /observe2 record.
-- destructive: reviewed — the table holds only the /observe2 pilot's field forms; nothing outside
-- /observe2 reads it.
-- SAFE ONLY after the code is rolled back or the /observe2 Flow ids are unset: the /observe2
-- endpoints and the capture link write it. Roll the CODE back first.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT (it cannot execute them).
DROP TRIGGER IF EXISTS observation_field_forms_keep_seal ON observation_field_forms;
DROP TRIGGER IF EXISTS update_observation_field_forms_updated_at ON observation_field_forms;
DROP FUNCTION IF EXISTS observation_field_forms_keep_seal();
DROP INDEX IF EXISTS idx_observation_field_forms_teacher;
DROP INDEX IF EXISTS uq_observation_field_forms_session;
DROP INDEX IF EXISTS idx_observation_field_forms_observer_recent;
DROP TABLE IF EXISTS observation_field_forms;
NOTIFY pgrst, 'reload schema';
