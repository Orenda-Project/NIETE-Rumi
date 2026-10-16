-- Rollback: child_phone_bindings_code.sql. Drops the index, then the column (which codes made which bindings is lost).
DROP INDEX IF EXISTS cpb_code;
ALTER TABLE child_phone_bindings DROP COLUMN IF EXISTS code_id;
