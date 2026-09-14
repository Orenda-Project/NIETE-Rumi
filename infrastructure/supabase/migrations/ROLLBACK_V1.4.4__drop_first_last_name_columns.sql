-- ROLLBACK for V1.4.4 — restore `users.first_name` / `users.last_name`.
--
-- ⚠️ READ THIS BEFORE RUNNING IT.
--
-- This restores the COLUMNS and the old function signatures. It does NOT and
-- cannot restore their CONTENTS: `DROP COLUMN` discards the data, and there is
-- no copy of it anywhere else.
--
-- That is a deliberate, measured acceptance rather than an oversight. On NIETE
-- prod 2026-09-14, across all 14,574 users:
--   · for the 5,494 people with no name at all, both columns were ALREADY empty
--   · for the 9,037 with a `name`, both were redundant with it
--   · the 43 whose name could ONLY be rebuilt from the split columns are
--     backfilled into `name` by V1.4.3, which runs FIRST
-- So the information content of the two columns at drop time is zero. What the
-- rollback restores is the SHAPE, which is what a rolled-back deployment's code
-- needs to start.
--
-- If a rolled-back build needs the split values populated, derive them from
-- `name` — that direction is lossless enough for a first name and is what the
-- application now does at render time:
--     UPDATE users
--     SET    first_name = split_part(name, ' ', 1),
--            last_name  = NULLIF(substr(name, strpos(name, ' ') + 1), name)
--     WHERE  COALESCE(TRIM(name), '') <> '';
-- It is left commented out on purpose: it INVENTS a first/last split that the
-- source data never asserted, and on Pakistani names ("Muhammad Kashif
-- Rafique", "Syed Asad Abbas") it guesses wrong often. Run it only if a
-- rolled-back consumer genuinely cannot read `name`.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);

-- Restore the pre-V1.4.4 function signatures.
CREATE OR REPLACE FUNCTION public.get_portal_users(p_portal_user_id uuid)
 RETURNS TABLE(id uuid, phone_number text, first_name text, school_name text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM set_config('app.portal_user_id', p_portal_user_id::text, true);
  RETURN QUERY
  SELECT
    u.id,
    u.phone_number::text,
    u.first_name::text,
    u.school_name::text
  FROM users u;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_users_with_last_activity(
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, phone_number text, name text, first_name text, last_name text,
               registration_completed boolean, registration_state text,
               registration_started_at timestamp with time zone,
               registration_completed_at timestamp with time zone,
               registration_state_updated_at timestamp with time zone,
               created_at timestamp with time zone,
               last_conversation_at timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    u.id, u.phone_number, u.name, u.first_name, u.last_name,
    u.registration_completed, u.registration_state, u.registration_started_at,
    u.registration_completed_at, u.registration_state_updated_at, u.created_at,
    MAX(c.created_at) as last_conversation_at
  FROM users u
  LEFT JOIN conversations c ON c.user_id = u.id
  GROUP BY
    u.id, u.phone_number, u.name, u.first_name, u.last_name,
    u.registration_completed, u.registration_state, u.registration_started_at,
    u.registration_completed_at, u.registration_state_updated_at, u.created_at
  ORDER BY COALESCE(MAX(c.created_at), u.created_at) DESC
  LIMIT p_limit
  OFFSET p_offset;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
