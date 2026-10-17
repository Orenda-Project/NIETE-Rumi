-- Rollback: child_phone_bindings_device.sql. Turn app_settings `web_quiz_remember_column` off first.
-- Drops only what it added; the binding rows themselves are untouched.

DROP TRIGGER IF EXISTS cpb_clear_device ON child_phone_bindings;
DROP FUNCTION IF EXISTS cpb_clear_device_on_revoke();
DROP INDEX IF EXISTS cpb_device;
ALTER TABLE child_phone_bindings DROP COLUMN IF EXISTS device_hash;
