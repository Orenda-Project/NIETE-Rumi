-- requires: child_identity.sql
-- Migration: child_phone_bindings.device_hash — the browser that made a binding, as a hash.
--
-- NON-DESTRUCTIVE. One nullable column on child_phone_bindings: hex(sha256(device_ref))[:32] of the
-- page's device ref (the same hash the home's cache keys use), written by a child's own join beside
-- the cache entry when app_settings `web_quiz_remember_column` is on. The first home's "Jugnu will
-- remember you on this phone" and the grown-ups corner's "Forget this phone" read it first, so they
-- survive a cache flush. It never decides who a child is; it only proves a tap comes from the phone
-- that joined. No phone, no name, never the raw device ref.
--
-- A revoked row never keeps it (as it never keeps the phone): the trigger clears it on every erase
-- (undo, STOP, expiry, a teacher), whatever the code that erased.
--
-- Idempotent: applying it twice is a no-op. Apply after child_identity.sql, BEFORE the switch flips.
-- Rollback: child_phone_bindings_device_rollback.sql (switch off first).
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

ALTER TABLE child_phone_bindings ADD COLUMN IF NOT EXISTS device_hash text;
CREATE INDEX IF NOT EXISTS cpb_device ON child_phone_bindings (device_hash) WHERE device_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION cpb_clear_device_on_revoke() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN
    NEW.device_hash := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cpb_clear_device ON child_phone_bindings;
CREATE TRIGGER cpb_clear_device BEFORE INSERT OR UPDATE ON child_phone_bindings
  FOR EACH ROW EXECUTE FUNCTION cpb_clear_device_on_revoke();
