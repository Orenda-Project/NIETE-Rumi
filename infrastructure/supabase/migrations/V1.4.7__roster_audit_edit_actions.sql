-- leader_roster_audit: let the coach EDIT actions be recorded.
--
-- WHY
--   The coach Edit flow added three new audit actions — edit_name, edit_level,
--   edit_phone and edit_phone_escalated — but `leader_roster_audit` carries a
--   CHECK that only admits the three the table was born with:
--
--     CHECK (action = ANY (ARRAY['add','remove','move']))
--
--   So every coach edit raised 23514 and wrote NOTHING. And `_editAudit`
--   deliberately swallows its errors (an unwritten audit row must never fail the
--   edit the coach just made), so the failure was completely silent: the edit
--   itself worked, the record of it did not.
--
--   Caught the only way it could be — a coach hit the Case-3 refusal screen on
--   production, and the escalation queue we built to catch exactly that was
--   empty when we went looking. The whole point of that path is that a human
--   picks the case up afterwards; without the row, nobody would have.
--
-- WHAT THIS DOES NOT FIX
--   The rows already lost are lost. This only stops the next one vanishing.
--
-- IDEMPOTENT: drops the old constraint by name and re-adds the wider one.

BEGIN;

ALTER TABLE leader_roster_audit
  DROP CONSTRAINT IF EXISTS leader_roster_audit_action_check;

ALTER TABLE leader_roster_audit
  ADD CONSTRAINT leader_roster_audit_action_check
  CHECK (action = ANY (ARRAY[
    -- the original roster verbs
    'add', 'remove', 'move',
    -- the coach Edit flow
    'edit_name', 'edit_level', 'edit_phone',
    -- and the refusal that needs a human afterwards
    'edit_phone_escalated'
  ]));

COMMENT ON COLUMN leader_roster_audit.action IS
  'What the coach did. add/remove/move are roster changes; edit_* are field '
  'edits from the Manage-teachers flow. edit_phone_escalated IS the escalation '
  'queue — a phone move refused because the destination holds real history, '
  'waiting on a human. Widening this list needs a migration (CHECK constraint).';

-- ------------------------------------------------------------ prove it took
-- Assert against the constraint definition rather than by inserting a probe
-- row: the table has other NOT NULLs, and a probe that trips one of THOSE
-- tells us nothing about the CHECK we came here to fix.
DO $$
DECLARE
  def  text;
  want text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint WHERE conname = 'leader_roster_audit_action_check';

  IF def IS NULL THEN
    RAISE EXCEPTION 'leader_roster_audit_action_check is missing after the migration';
  END IF;

  FOREACH want IN ARRAY ARRAY['add','remove','move',
                              'edit_name','edit_level','edit_phone',
                              'edit_phone_escalated'] LOOP
    IF def NOT LIKE ('%' || quote_literal(want) || '%') THEN
      RAISE EXCEPTION 'the widened CHECK does not admit %  (def: %)', want, def;
    END IF;
  END LOOP;
END $$;
