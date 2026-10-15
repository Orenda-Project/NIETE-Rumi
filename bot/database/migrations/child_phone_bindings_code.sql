-- requires: child_identity.sql
-- Migration: child_phone_bindings.code_id — the JUGNU- code that made (or last renewed) a binding.
--
-- NON-DESTRUCTIVE. One nullable column on child_phone_bindings, a foreign key to
-- child_bind_codes(code). The page's Undo erases THE ONE binding its code made by
-- this column; rows written before it keep NULL and are matched by the instant the
-- binder stamped on them. No phone, no name: a code is a single-use, one-hour token.
--
-- Idempotent: applying it twice is a no-op. Apply after child_identity.sql.
-- Rollback: child_phone_bindings_code_rollback.sql.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

ALTER TABLE child_phone_bindings ADD COLUMN IF NOT EXISTS code_id text REFERENCES child_bind_codes(code);
CREATE INDEX IF NOT EXISTS cpb_code ON child_phone_bindings (code_id) WHERE code_id IS NOT NULL;
