-- requires: child_identity.sql
-- Migration: child_language — the language a child's links open in, one row per child.
--
-- NON-DESTRUCTIVE. One new table; nothing here touches an existing table.
--
--   child_language  canonical_id (the child, students.id after the merged_into fold, as
--                   child_identity.canonical_id) → language (en | ur) and where it came from:
--                     'join'   the join link's language, written once when a child joins on their own
--                     'chosen' a grown-up's tap on the home's grown-ups corner (the only update)
--                   Read by the links that open the child's home under app_settings
--                   web_quiz_return_lang; nothing reads it with the switch off.
--
-- One row per child, no school year and no grade: a roster child who never played a counted
-- challenge has no child_identity row, and a grown-up's choice must still be kept for them.
--
-- Idempotent: applying it twice is a no-op. Apply after child_identity.sql.
-- Rollback: child_language_rollback.sql.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS child_language (
  canonical_id   uuid        PRIMARY KEY,           -- the child (as child_identity.canonical_id)
  language       text        NOT NULL CHECK (language IN ('en','ur')),
  source         text        NOT NULL CHECK (source IN ('join','chosen')),
  set_at         timestamptz NOT NULL DEFAULT now()
);

-- Row Level Security: the bot writes with the service role (which bypasses RLS); nothing else
-- may read a child's row.
ALTER TABLE child_language ENABLE ROW LEVEL SECURITY;
