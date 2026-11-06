-- ROLLBACK_V1.9.1 — reverse of V1.9.1 GB curriculum key (bd-rj6w0n.14.15), Flyway-style rollback applied by migrate.js.
-- Nothing to undo here: V1.9.1 only completes V1.8.6's rename, and ROLLBACK_V1.8.6 puts GB back to 'gb'. Reversing it
-- here as well would undo V1.8.6 on a database where V1.8.6 itself did the rename.
-- NO BEGIN/COMMIT: migrate.js runs the file as one exec_sql call.

NOTIFY pgrst, 'reload schema';
