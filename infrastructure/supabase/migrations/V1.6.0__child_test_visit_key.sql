-- V1.6.0 — child_test: a visit key for a child-test list with no observe2 visit (bd-s1oo0.11,
-- CONTRACT v0.7 §12 CR-1). Versioned migration. Applied per environment, in order, from
-- infrastructure/supabase/migrations.
--
-- WHY. The draw is idempotent per visit, and V1.5.9 named the visit only by an observe2 field form
-- (child_test_draws.last_listed_visit_id, child_test_sessions.visit_id → observation_field_forms).
-- Two coach paths have no field form: /egra on a visit day with no /observe2 visit, and the offer
-- after classic /observe (what production ICT runs). They name their visit with a key instead:
--   cs:<coaching_session_id>                                  classic /observe
--   day:<coachUserId>:<schoolId>:<YYYY-MM-DD, Pakistan time>  /egra with no visit
-- (bot/shared/services/child-test/draw/visit-key.js builds and parses them.)
--
-- WHAT (additive; every V1.5.9 guard trigger and constraint is left as it is):
--   · child_test_draws.visit_key     next to last_listed_visit_id: the visit the row is listed at;
--   · child_test_sessions.visit_key  next to visit_id;
--   · a format check on both (cs:/day: with uuids and a calendar-shaped date);
--   · a row names at most one visit: never a field form id AND a key;
--   · a row that needs a visit names one — a listed draw (list_slot set, status 'listed') and a new
--     session. This is a trigger, not a CHECK, on purpose: V1.5.9 keeps the draw and the session
--     when their field form is deleted (FK ON DELETE SET NULL). A CHECK requiring a visit would make
--     that SET NULL fail, i.e. refuse to delete a field form or a coach. The trigger fires only on
--     the writes the bot makes (INSERT, or an UPDATE that sets list_slot/status/visit_key), never on
--     the foreign key's own SET NULL;
--   · indexes for the two lookups by key (reopening a visit's list, a visit's sessions).
--
-- DATA. Ids and a date only. No child data. LOAD. One indexed read per /egra open, as before.
-- SECURITY. Unchanged: RLS on, no policies, service role only.
-- IDEMPOTENT. IF NOT EXISTS / DROP ... IF EXISTS throughout.
-- Rollback: ROLLBACK_V1.6.0__child_test_visit_key.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE child_test_draws ADD COLUMN IF NOT EXISTS visit_key text;
ALTER TABLE child_test_sessions ADD COLUMN IF NOT EXISTS visit_key text;

ALTER TABLE child_test_draws DROP CONSTRAINT IF EXISTS child_test_draws_visit_key_format;
ALTER TABLE child_test_draws ADD CONSTRAINT child_test_draws_visit_key_format CHECK (
  visit_key IS NULL OR visit_key ~ '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$'
);
ALTER TABLE child_test_draws DROP CONSTRAINT IF EXISTS child_test_draws_one_visit;
ALTER TABLE child_test_draws ADD CONSTRAINT child_test_draws_one_visit
  CHECK (num_nonnulls(last_listed_visit_id, visit_key) <= 1);

ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_visit_key_format;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_visit_key_format CHECK (
  visit_key IS NULL OR visit_key ~ '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$'
);
ALTER TABLE child_test_sessions DROP CONSTRAINT IF EXISTS child_test_sessions_one_visit;
ALTER TABLE child_test_sessions ADD CONSTRAINT child_test_sessions_one_visit
  CHECK (num_nonnulls(visit_id, visit_key) <= 1);

-- Reopening a visit's list by key; a visit's sessions by key.
CREATE INDEX IF NOT EXISTS idx_child_test_draws_visit_key
  ON child_test_draws (visit_key) WHERE visit_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_child_test_sessions_visit_key
  ON child_test_sessions (visit_key) WHERE visit_key IS NOT NULL;

-- A listed draw names the visit it is listed at.
CREATE OR REPLACE FUNCTION child_test_draws_name_visit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.list_slot IS NOT NULL AND NEW.status = 'listed'
    AND num_nonnulls(NEW.last_listed_visit_id, NEW.visit_key) = 0 THEN
    RAISE EXCEPTION 'child_test_draws %: a listed child must name its visit (last_listed_visit_id or visit_key)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS child_test_draws_name_visit ON child_test_draws;
CREATE TRIGGER child_test_draws_name_visit
  BEFORE INSERT OR UPDATE OF list_slot, status, visit_key ON child_test_draws
  FOR EACH ROW EXECUTE FUNCTION child_test_draws_name_visit();

-- A session is started at a visit.
CREATE OR REPLACE FUNCTION child_test_sessions_name_visit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF num_nonnulls(NEW.visit_id, NEW.visit_key) = 0 THEN
    RAISE EXCEPTION 'child_test_sessions: a session must name its visit (visit_id or visit_key)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS child_test_sessions_name_visit ON child_test_sessions;
CREATE TRIGGER child_test_sessions_name_visit
  BEFORE INSERT ON child_test_sessions
  FOR EACH ROW EXECUTE FUNCTION child_test_sessions_name_visit();

COMMENT ON COLUMN child_test_draws.visit_key IS
  'Internal. The visit the row is listed at when that visit has no observe2 field form: cs:<coaching_session_id> (classic /observe) or day:<coach>:<school>:<YYYY-MM-DD PKT> (/egra with no visit). Never set together with last_listed_visit_id.';
COMMENT ON COLUMN child_test_sessions.visit_key IS
  'Internal. The visit key (see child_test_draws.visit_key) when the visit has no observe2 field form. Never set together with visit_id.';

NOTIFY pgrst, 'reload schema';
