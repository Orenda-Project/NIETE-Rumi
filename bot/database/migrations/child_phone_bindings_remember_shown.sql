-- requires: child_phone_bindings_device.sql
-- Migration: child_phone_bindings.remember_shown_at — when the first home drew "Jugnu will remember you on this phone".
--
-- NON-DESTRUCTIVE. One nullable column on child_phone_bindings, set once (only while empty) by the first home that
-- draws the line for that binding, when app_settings `web_quiz_remember_shown_row` and `web_quiz_remember_column` are
-- on. The home reads nothing else from it: a second open of the join's redirect after a cache flush finds it set and
-- draws no second line. No phone, no name, no device.
--
-- Idempotent: applying it twice is a no-op. Apply after child_phone_bindings_device.sql, BEFORE the switch flips.
-- Rollback: child_phone_bindings_remember_shown_rollback.sql (switch off first).
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

ALTER TABLE child_phone_bindings ADD COLUMN IF NOT EXISTS remember_shown_at timestamptz;
