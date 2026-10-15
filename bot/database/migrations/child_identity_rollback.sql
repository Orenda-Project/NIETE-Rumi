-- Rollback: child_identity.sql. Drops the four tables in reverse order (nothing else references them).
DROP TABLE IF EXISTS merge_log;
DROP TABLE IF EXISTS child_bind_codes;
DROP TABLE IF EXISTS child_phone_bindings;
DROP TABLE IF EXISTS child_identity;
