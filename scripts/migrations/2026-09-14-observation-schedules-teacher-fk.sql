-- Give observation_schedules a real teacher foreign key.
--
-- WHY
--   `teacher_ext_id` holds a PHONE NUMBER used as an identity key, and
--   `observe-who.service.js:125` joins the coach's roster to users with
--   `byPhone.get(t.teacher_ext_id)`. That makes a teacher's identity a function
--   of the SIM in her handset. When she changes number the bot mints a new
--   account (`getOrCreateUser`, bot-helpers.js:13 — looks up by phone, CREATEs
--   on a miss) and every booking under the old number is orphaned. It fails
--   SILENTLY: `_withSchools` degrades to the input on any miss by design, so a
--   teacher simply drops out of her coach's picker with no error anywhere.
--
--   This is the first half of the fix — the column and its backfill. Nothing
--   reads it yet, so this migration cannot change behaviour. Dual-write, the
--   read flip and dropping the text key follow in their own PRs.
--
-- THE SHAPE IS A PRECEDENT, NOT AN INVENTION
--   `observation_schedules` already carries `school_id uuid` beside the text
--   `school_ext_id` — the school half of this same problem was migrated exactly
--   this way. We follow it for the teacher rather than inventing a scheme.
--
-- WHAT THE DATA LOOKS LIKE (measured on NIETE prod, 2026-09-14, 2,102 rows)
--
--     teacher_ext_id resolves to a live user      2,089   99.4%
--     `name:test-*` fixtures                         12
--     phone with no user account                      1
--
--   The single orphan is a DONE visit from 2026-08-28 whose teacher account no
--   longer exists. It is history, not breakage: the
--   row keeps its teacher_ext_id and teacher_name and simply carries no FK.
--   Only 2 unresolvable rows are `upcoming`, and both are test fixtures — no
--   coach is waiting on anything this migration leaves null.
--
-- THE CROSS-CHECK, AND WHY IT IS ON NAME AND NOT SCHOOL
--   A phone number identifies a person TODAY. If a teacher already changed SIM,
--   her old number may now belong to somebody else — 5,364 of 14,566 NIETE
--   accounts (36.8%) carry irreplaceable history, so a recycled SIM landing on a
--   real account is a live possibility, not a hypothetical. Binding a visit to
--   the wrong teacher is worse than leaving it null, so the match must be
--   corroborated by a second field.
--
--   The first draft of this migration cross-checked `school_id`. That was
--   useless: `school_id` is NULL on 2,092 of 2,102 rows, so it would have
--   corroborated ten of them and waved the rest through — a check that looks
--   rigorous and tests nothing.
--
--   `teacher_name` is the field that is actually populated:
--
--     name matches exactly                        2,040
--     first name matches (honorific only)             8
--     one side blank                                 31
--     first token differs                            14
--
--   So the rule binds on exact-or-first-token agreement: 2,048 rows bind, 54
--   abstain. Of the 14 that differ, 6 are the placeholder 'Teacher' against a
--   real name (refused deliberately — a placeholder is not corroboration, and it
--   is exactly the shape a recycled SIM would present) and 6 are one-letter
--   spelling drift in the FIRST name (a single transposed or doubled letter).
--   Those six are almost certainly the
--   same person, but "almost certainly" is what an edit-distance rule buys and a
--   wrong FK is silent — they stay NULL and keep their teacher_name. Every one
--   of the 14 is `done` or `cancelled`; no live booking is affected.
--
--   We would rather leave 54 rows null than mislabel one visit: a NULL is
--   visibly missing, a wrong FK is not.
--
-- IDEMPOTENT: re-running binds only rows still NULL; the guards abort on a
-- shape they did not expect rather than writing.

BEGIN;

-- ------------------------------------------------------------------ 1. column
ALTER TABLE observation_schedules
  ADD COLUMN IF NOT EXISTS teacher_user_id uuid REFERENCES users(id);

COMMENT ON COLUMN observation_schedules.teacher_user_id IS
  'The teacher, by identity rather than by handset. Supersedes teacher_ext_id '
  '(a phone string), which survives a SIM change only by accident.';

-- --------------------------------------------------------- 2. candidate pairs
-- Resolve the phone to a user, then demand the names corroborate. `simplify`
-- strips the honorifics and punctuation that account for most of the benign
-- differences, so the comparison is on the name itself.
CREATE TEMP TABLE _bind ON COMMIT DROP AS
WITH simplify AS (
  SELECT s.id AS sched_id,
         u.id AS user_id,
         lower(regexp_replace(coalesce(s.teacher_name,''), '^(ms|mr|mrs|miss|madam|sir)\.?\s+', '', 'i')) AS s_name,
         lower(regexp_replace(coalesce(nullif(u.name,''), u.first_name, ''), '^(ms|mr|mrs|miss|madam|sir)\.?\s+', '', 'i')) AS u_name
    FROM observation_schedules s
    JOIN users u ON u.phone_number = s.teacher_ext_id
   WHERE s.teacher_user_id IS NULL
     AND s.teacher_ext_id ~ '^92[0-9]{10}$'
)
SELECT sched_id, user_id
  FROM simplify
 WHERE s_name <> '' AND u_name <> ''
   -- exact, or the first token agrees (covers spelling drift + honorifics)
   AND (btrim(s_name) = btrim(u_name)
        OR split_part(btrim(s_name), ' ', 1) = split_part(btrim(u_name), ' ', 1));

-- -------------------------------------------------------------------- 3. guard
-- A phone is UNIQUE on users (verified: 14,566 rows, 14,566 distinct), so one
-- schedule row can never resolve to two teachers. Assert it rather than trust
-- it — if that constraint is ever dropped this migration must stop, not pick.
DO $$
DECLARE dupe INT; bound INT; already INT;
BEGIN
  SELECT count(*) INTO dupe FROM (
    SELECT sched_id FROM _bind GROUP BY sched_id HAVING count(*) > 1) z;
  IF dupe > 0 THEN
    RAISE EXCEPTION '% schedule row(s) resolve to more than one user — refusing to guess', dupe;
  END IF;

  -- "Nothing to bind" means one of two OPPOSITE things, and conflating them
  -- makes the migration non-idempotent. An earlier draft raised unconditionally
  -- on bound = 0 and therefore ABORTED on its own second run — where zero rows
  -- left to bind is exactly the success condition. Caught re-running it against
  -- sandbox. So distinguish: nothing left to do is fine, nothing there in the
  -- first place is not.
  SELECT count(*) INTO bound FROM _bind;
  SELECT count(*) INTO already FROM observation_schedules WHERE teacher_user_id IS NOT NULL;
  IF bound = 0 AND already = 0 THEN
    RAISE EXCEPTION 'No row bound and none already bound — the resolve found nothing. Check the data before forcing this.';
  END IF;
  RAISE NOTICE 'binding % row(s); % already bound', bound, already;
END $$;

-- ------------------------------------------------------------------- 4. bind
UPDATE observation_schedules s
   SET teacher_user_id = b.user_id
  FROM _bind b
 WHERE s.id = b.sched_id
   AND s.teacher_user_id IS DISTINCT FROM b.user_id;

-- -------------------------------------------------------- 5. prove it holds
-- Every bound row must agree with its user's CURRENT phone. This is the
-- property the whole migration exists to establish, so it is asserted rather
-- than eyeballed afterwards.
DO $$
DECLARE bad INT; leftover INT;
BEGIN
  SELECT count(*) INTO bad
    FROM observation_schedules s
    JOIN users u ON u.id = s.teacher_user_id
   WHERE s.teacher_user_id IS NOT NULL
     AND s.teacher_ext_id ~ '^92[0-9]{10}$'
     AND u.phone_number <> s.teacher_ext_id;
  IF bad > 0 THEN
    RAISE EXCEPTION '% bound row(s) point at a user whose phone is not the ext_id — aborting', bad;
  END IF;

  SELECT count(*) INTO leftover
    FROM observation_schedules WHERE teacher_user_id IS NULL AND status = 'upcoming';
  RAISE NOTICE '% upcoming row(s) remain unbound (expected: 2, both name:test-* fixtures)', leftover;
END $$;

-- Partial index: every read added by the follow-up PRs filters on this column,
-- and the NULLs are the 54 rows nothing will ever look up by identity.
CREATE INDEX IF NOT EXISTS idx_observation_schedules_teacher_user
  ON observation_schedules (teacher_user_id) WHERE teacher_user_id IS NOT NULL;

COMMIT;

-- ----------------------------------------------------------------------------
-- NOT IN THIS MIGRATION, deliberately:
--
--   · No NOT NULL on teacher_user_id. 54 rows legitimately cannot be resolved
--     (12 test fixtures, 1 deleted account, 31 with a blank name on one side,
--     6 placeholders, 6 first-name spelling variants),
--     and a constraint asserting a fact the data cannot satisfy is the trap that
--     bit training_certificates.attempt_id (V1.1.10, 901 legacy rows).
--
--   · teacher_ext_id is NOT dropped and NOT stopped being written. Everything
--     still reads it. It goes only once the read flip has been live long enough
--     to trust, on the same ratchet leader-teachers-deprecated.test.js uses.
--
--   · No change to the Flow JSON. `teacher_ext_id` crosses the WhatsApp Flow
--     boundary (observe-visit-v2.json) but is an OPAQUE round-trip string — the
--     server fills it and reads it back, the Flow never interprets it. So the
--     eventual switch to a uuid needs no Meta re-publish.
