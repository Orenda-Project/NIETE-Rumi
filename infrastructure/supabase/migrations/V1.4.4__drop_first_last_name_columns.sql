-- bd-60092 · Drop `users.first_name` and `users.last_name`.
--
-- ⚠️ RUN THIS ONLY AFTER THE CODE THAT READS THEM IS DEPLOYED AND VERIFIED LIVE.
-- Applying it while a running instance still SELECTs these columns is an
-- immediate outage on every affected path. The order is:
--     1. V1.4.3 backfill            (safe any time, idempotent)
--     2. the FDE name backfill      (scripts/backfill-names-from-fde.js)
--     3. deploy the code sweep      (sandbox -> staging -> main)
--     4. verify live, THEN this     (needs an explicit operator go)
--
-- Why the columns go rather than the name column:
--   · A first name is `name.split(' ')[0]` — computable, so storing it only
--     creates a second source that can disagree.
--   · They DID disagree: three writers meant different things by `name`
--     (feature-registration wrote a FIRST name into it, flow-response a FULL
--     name, observe-teacher-admin wrote the full name into `first_name`),
--     which is how 6,820 people ended up with a one-word first_name beside a
--     multi-word name.
--   · Measured 2026-09-14: dropping them destroys nothing. For the 5,494
--     nameless users both columns are already empty; for the 9,037 with a
--     `name` they are redundant. 43 rows are rescued by V1.4.3 first.
--
-- Two functions must be replaced in the SAME transaction or the drop fails on
-- dependency: get_portal_users and get_users_with_last_activity both project
-- the columns. 00_complete-schema.sql carries the same new definitions.

BEGIN;

-- 1. Re-create the dependent functions without the dropped columns.
CREATE OR REPLACE FUNCTION public.get_portal_users(p_portal_user_id uuid)
 RETURNS TABLE(id uuid, phone_number text, name text, school_name text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM set_config('app.portal_user_id', p_portal_user_id::text, true);
  RETURN QUERY
  SELECT
    u.id,
    u.phone_number::text,
    u.name::text,
    u.school_name::text
  FROM users u;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_users_with_last_activity(
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, phone_number text, name text, registration_completed boolean,
               registration_state text, registration_started_at timestamp with time zone,
               registration_completed_at timestamp with time zone,
               registration_state_updated_at timestamp with time zone,
               created_at timestamp with time zone,
               last_conversation_at timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    u.id,
    u.phone_number,
    u.name,
    u.registration_completed,
    u.registration_state,
    u.registration_started_at,
    u.registration_completed_at,
    u.registration_state_updated_at,
    u.created_at,
    MAX(c.created_at) as last_conversation_at
  FROM users u
  LEFT JOIN conversations c ON c.user_id = u.id
  GROUP BY
    u.id, u.phone_number, u.name, u.registration_completed, u.registration_state,
    u.registration_started_at, u.registration_completed_at,
    u.registration_state_updated_at, u.created_at
  ORDER BY COALESCE(MAX(c.created_at), u.created_at) DESC
  LIMIT p_limit
  OFFSET p_offset;
$function$;

-- 2. Drop the columns. CASCADE is deliberately NOT used: if something still
--    depends on them, this migration must fail loudly rather than silently
--    delete a view or an index nobody knew about.
ALTER TABLE users DROP COLUMN IF EXISTS first_name;
ALTER TABLE users DROP COLUMN IF EXISTS last_name;

COMMIT;
