-- Rollback: child_phone_bindings_remember_shown.sql. Turn app_settings `web_quiz_remember_shown_row` off first.
-- Drops only what it added; the binding rows themselves are untouched.

ALTER TABLE child_phone_bindings DROP COLUMN IF EXISTS remember_shown_at;
