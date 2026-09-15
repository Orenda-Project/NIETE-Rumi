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
-- PRODUCTION FIX (2026-09-14): `CREATE OR REPLACE` cannot RENAME an OUT column.
-- Production's live get_portal_users returns a column literally named
-- `first_name`; this migration renames that output to `name`, so Postgres
-- refused the whole transaction with:
--     42P13 cannot change return type of existing function
--     hint: Use DROP FUNCTION get_portal_users(uuid) first.
-- The migration is transactional, so it aborted atomically and changed nothing.
-- Neither function is called from application code (verified by grep across
-- bot/, dashboard/ and portal/ on main: the only references are SQL files and a
-- schema-parity test), so dropping and recreating them is safe.
-- PRODUCTION FIX 2 (2026-09-14): the materialized views select the columns too.
-- Staging surfaced this AFTER the function fix:
--     2BP01 cannot drop column first_name of table users because other objects
--     depend on it: materialized view mv_users_activity depends on column
--     first_name; materialized view mv_view_refresh_status depends on
--     mv_users_activity.  hint: Use DROP ... CASCADE
-- CASCADE is the WRONG answer: it would silently delete both views. On prod
-- mv_users_activity holds 14,879 rows and is read by
-- dashboard/services/materialized-views.service.js. So the view is rebuilt
-- WITHOUT the two columns, from its live definition (pg_get_viewdef), with all
-- six of its indexes recreated verbatim. mv_view_refresh_status does not
-- reference first_name/last_name itself; it only depends on this view, so it is
-- dropped and recreated unchanged.
DROP MATERIALIZED VIEW IF EXISTS public.mv_view_refresh_status;
DROP MATERIALIZED VIEW IF EXISTS public.mv_users_activity;

CREATE MATERIALIZED VIEW public.mv_users_activity AS
 SELECT u.id,
    u.phone_number,
    "left"(u.phone_number::text, 2) AS country_code,
    lower(COALESCE(u.school_name, ''::character varying)::text) AS school_name_lower,
    COALESCE(u.is_test_user, false) AS is_test_user,
    u.name,
    u.preferred_language,
    u.registration_completed,
    u.registration_state,
    u.registration_started_at,
    u.registration_completed_at,
    u.registration_state_updated_at,
    u.created_at,
    max(c.created_at) AS last_activity,
    count(c.id) AS total_messages,
    count(c.id) FILTER (WHERE c.role::text = 'user'::text) AS user_messages,
    count(c.id) FILTER (WHERE c.message_type::text = 'voice'::text) AS voice_messages,
    now() AS last_refreshed
   FROM users u
     LEFT JOIN conversations c ON c.user_id = u.id
  GROUP BY u.id;

CREATE UNIQUE INDEX idx_mv_users_activity_id ON public.mv_users_activity USING btree (id);
CREATE INDEX idx_mv_users_activity_country ON public.mv_users_activity USING btree (country_code) WHERE (is_test_user = false);
CREATE INDEX idx_mv_users_activity_school ON public.mv_users_activity USING btree (school_name_lower) WHERE ((is_test_user = false) AND (school_name_lower <> ''::text));
CREATE INDEX idx_mv_users_activity_phone ON public.mv_users_activity USING btree (phone_number);
CREATE INDEX idx_mv_users_activity_last_activity ON public.mv_users_activity USING btree (last_activity DESC NULLS LAST);
CREATE INDEX idx_mv_users_activity_created ON public.mv_users_activity USING btree (created_at DESC);

-- Recreated verbatim from its live definition; it never referenced the dropped
-- columns, it only depended on mv_users_activity.
CREATE MATERIALIZED VIEW public.mv_view_refresh_status AS
 SELECT 'mv_dashboard_stats'::text AS view_name,
    ( SELECT mv_dashboard_stats.last_refreshed FROM mv_dashboard_stats LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count FROM mv_dashboard_stats) AS row_count
UNION ALL
 SELECT 'mv_users_activity'::text AS view_name,
    ( SELECT mv_users_activity.last_refreshed FROM mv_users_activity LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count FROM mv_users_activity) AS row_count
UNION ALL
 SELECT 'mv_retention_cohorts'::text AS view_name,
    ( SELECT mv_retention_cohorts.last_refreshed FROM mv_retention_cohorts LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count FROM mv_retention_cohorts) AS row_count
UNION ALL
 SELECT 'mv_dashboard_stats_by_country'::text AS view_name,
    ( SELECT mv_dashboard_stats_by_country.last_refreshed FROM mv_dashboard_stats_by_country LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count FROM mv_dashboard_stats_by_country) AS row_count
WITH NO DATA;
-- WITH NO DATA: this view reads the other mv_* views, and creating it eagerly
-- fails wherever one of them is unpopulated (55000 on staging, from
-- mv_retention_cohorts). It is a status view refreshed by the dashboard's own
-- refresh cycle, so deferring population costs nothing.

CREATE UNIQUE INDEX idx_mv_view_refresh_status_pk ON public.mv_view_refresh_status USING btree (view_name);

DROP FUNCTION IF EXISTS public.get_portal_users(uuid);
DROP FUNCTION IF EXISTS public.get_users_with_last_activity(integer, integer);

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
--
-- destructive: reviewed — the data loss is zero and was measured before the
-- drop. Of 14,574 users on 2026-09-14: both columns are already empty for the
-- 5,494 with no name, redundant with `name` for the 9,037 who have one, and the
-- 43 rows whose name could ONLY be rebuilt from these two are backfilled into
-- `name` by V1.4.3, which runs first. Rollback (shape, not contents — and why
-- that is sufficient): ROLLBACK_V1.4.4__drop_first_last_name_columns.sql
ALTER TABLE users DROP COLUMN IF EXISTS first_name;
ALTER TABLE users DROP COLUMN IF EXISTS last_name;

COMMIT;
