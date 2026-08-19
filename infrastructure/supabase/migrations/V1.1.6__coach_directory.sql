-- V1.1.6 — coach_directory: the coach → work-email mapping, resolved ONCE.
--
-- WHY THIS TABLE EXISTS
-- ---------------------
-- Calendar invites for scheduled observations need an email address for the
-- coach. The bot has never held one: `users` carries a phone number, because
-- that is what a WhatsApp product needs. The addresses live in a third database
-- — the Markaz HRMIS (Neon), `employee_profiles.official_email` joined to
-- `users` — which this deployment cannot reach at runtime and should not.
--
-- WHY IT IS A TABLE AND NOT A LOOKUP
-- ----------------------------------
-- The alternative is resolving a name to an address per invite. That is the one
-- design that must not ship. Name matching is probabilistic, and it fails
-- silently in the worst direction: a difflib pass at cutoff 0.80, run while
-- preparing this work, matched one coach's name to a mailbox belonging to a
-- DIFFERENT person at a DIFFERENT organisation, purely because the two strings
-- share letters. One wrong match puts a school visit on a stranger's calendar; a
-- miss merely leaves a coach without an invite. We prefer the miss, every time.
--
-- So the resolution happens ONCE, deterministically, under human review, and is
-- written here. Everything afterwards reads this table by leader_user_id.
--
-- WHY NOT A COLUMN ON users
-- -------------------------
-- (Anti-sprawl check, root rule 15.) `users.email` does not exist on this
-- deployment, and adding one would invite every future feature to treat it as a
-- contact channel for TEACHERS, who have phones and no email. This is a narrow
-- fact about a small staff population — 52 coaches of 9,000+ users — with its
-- own provenance and its own confirmation state. It also has to record HOW each
-- row was matched, which a bare column cannot carry.
--
-- WHAT match_method MEANS
-- -----------------------
--   'exact'     — resolved deterministically (normalised full-name equality, or
--                 the email local-part, or token-set equality). Written by the
--                 seed script without a human in the loop.
--   'confirmed' — a human looked at a near match and said yes. confirmed_at is
--                 then NOT NULL, and that is what makes it writable.
--   'manual'    — typed in by a human from a source outside the roster.
--
-- Nothing auto-writes a fuzzy match. A row that does not resolve deterministically
-- goes to a CSV for a person, never to this table.
--
-- SAFETY
-- ------
-- Additive. No existing table is touched. Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS coach_directory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  work_email      text NOT NULL,
  hrmis_user_id   integer,
  match_method    text NOT NULL DEFAULT 'exact'
                    CHECK (match_method IN ('exact', 'confirmed', 'manual')),
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One row per coach. The uniqueness IS the point: it is what makes "resolve
  -- once, read thereafter" enforceable rather than merely intended.
  CONSTRAINT coach_directory_leader_user_id_key UNIQUE (leader_user_id),
  -- A near match may only be stored once a human has said yes.
  CONSTRAINT coach_directory_confirmed_requires_timestamp
    CHECK (match_method <> 'confirmed' OR confirmed_at IS NOT NULL)
);

-- The read path is "given this coach, what is her address?".
CREATE INDEX IF NOT EXISTS idx_coach_directory_leader ON coach_directory (leader_user_id);

COMMIT;
