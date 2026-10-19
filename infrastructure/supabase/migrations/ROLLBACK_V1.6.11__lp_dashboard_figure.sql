-- ROLLBACK V1.6.11 — mv_dashboard_stats_by_country back to its definition before V1.6.11 (verbatim, from the live
-- sandbox DB, 2026-10-16): the lesson-plan figure counts every lesson_plan_requests row again, over the per-user
-- join. mv_view_refresh_status and the unique indexes are recreated as they were; the owner and grants are this
-- database's own, read before the DROP and put back exactly (see V1.6.11: the NIETE databases grant these views
-- differently). lock_timeout 5s, as in V1.6.11. Idempotent.

DO $$ BEGIN
  -- Never queue behind the portal's refresh with the view's readers queued behind us: fail fast and be re-run.
  PERFORM set_config('lock_timeout', '5s', true);
END $$;

-- This database's owner and grants on the two views, before the DROP (put back at the end of the file).
CREATE TEMP TABLE v1611_views ON COMMIT DROP AS
  SELECT c.relname::text AS relname, c.relowner
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'm'
     AND c.relname IN ('mv_dashboard_stats_by_country', 'mv_view_refresh_status');
CREATE TEMP TABLE v1611_grants ON COMMIT DROP AS
  SELECT c.relname::text AS relname, a.grantee, a.privilege_type, a.is_grantable
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'm'
     AND c.relname IN ('mv_dashboard_stats_by_country', 'mv_view_refresh_status')
     AND a.grantee <> c.relowner;

DROP MATERIALIZED VIEW IF EXISTS public.mv_view_refresh_status;
DROP MATERIALIZED VIEW IF EXISTS public.mv_dashboard_stats_by_country;

CREATE MATERIALIZED VIEW public.mv_dashboard_stats_by_country AS
WITH user_stats AS (
         SELECT "left"(u.phone_number::text, 2) AS country_code,
            count(*) AS total_users,
            count(*) FILTER (WHERE u.registration_completed = true) AS registered_users,
            count(*) FILTER (WHERE u.created_at >= (now() - '1 day'::interval)) AS new_users_today,
            count(*) FILTER (WHERE u.created_at >= (now() - '7 days'::interval)) AS new_users_week
           FROM users u
          WHERE COALESCE(u.is_test_user, false) = false
          GROUP BY ("left"(u.phone_number::text, 2))
        ), message_stats AS (
         SELECT "left"(u.phone_number::text, 2) AS country_code,
            count(c.id) AS total_messages,
            count(c.id) FILTER (WHERE c.created_at >= (now() - '1 day'::interval)) AS messages_today,
            count(DISTINCT c.user_id) FILTER (WHERE c.created_at >= (now() - '1 day'::interval)) AS dau,
            count(DISTINCT c.user_id) FILTER (WHERE c.created_at >= (now() - '7 days'::interval)) AS wau
           FROM users u
             LEFT JOIN conversations c ON c.user_id = u.id
          WHERE COALESCE(u.is_test_user, false) = false
          GROUP BY ("left"(u.phone_number::text, 2))
        ), feature_stats AS (
         SELECT "left"(u.phone_number::text, 2) AS country_code,
            count(DISTINCT lp.id) AS lesson_plans,
            count(DISTINCT cs.id) AS coaching_sessions,
            count(DISTINCT ra.id) AS reading_assessments,
            count(DISTINCT vr.id) AS video_requests
           FROM users u
             LEFT JOIN lesson_plan_requests lp ON lp.user_id = u.id
             LEFT JOIN coaching_sessions cs ON cs.user_id = u.id
             LEFT JOIN reading_assessments ra ON ra.user_id = u.id
             LEFT JOIN video_requests vr ON vr.user_id = u.id
          WHERE COALESCE(u.is_test_user, false) = false
          GROUP BY ("left"(u.phone_number::text, 2))
        )
 SELECT us.country_code,
    us.total_users,
    us.registered_users,
    us.new_users_today,
    us.new_users_week,
    COALESCE(ms.total_messages, 0::bigint) AS total_messages,
    COALESCE(ms.messages_today, 0::bigint) AS messages_today,
    COALESCE(ms.dau, 0::bigint) AS daily_active_users,
    COALESCE(ms.wau, 0::bigint) AS weekly_active_users,
    COALESCE(fs.lesson_plans, 0::bigint) AS total_lesson_plans,
    COALESCE(fs.coaching_sessions, 0::bigint) AS total_coaching_sessions,
    COALESCE(fs.reading_assessments, 0::bigint) AS total_reading_assessments,
    COALESCE(fs.video_requests, 0::bigint) AS total_video_requests,
    now() AS last_refreshed
   FROM user_stats us
     LEFT JOIN message_stats ms ON ms.country_code = us.country_code
     LEFT JOIN feature_stats fs ON fs.country_code = us.country_code
WITH DATA;

CREATE UNIQUE INDEX idx_mv_dashboard_stats_by_country_pk ON public.mv_dashboard_stats_by_country USING btree (country_code);

CREATE MATERIALIZED VIEW public.mv_view_refresh_status AS
SELECT 'mv_dashboard_stats'::text AS view_name,
    ( SELECT mv_dashboard_stats.last_refreshed
           FROM mv_dashboard_stats
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM mv_dashboard_stats) AS row_count
UNION ALL
 SELECT 'mv_users_activity'::text AS view_name,
    ( SELECT mv_users_activity.last_refreshed
           FROM mv_users_activity
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM mv_users_activity) AS row_count
UNION ALL
 SELECT 'mv_retention_cohorts'::text AS view_name,
    ( SELECT mv_retention_cohorts.last_refreshed
           FROM mv_retention_cohorts
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM mv_retention_cohorts) AS row_count
UNION ALL
 SELECT 'mv_dashboard_stats_by_country'::text AS view_name,
    ( SELECT mv_dashboard_stats_by_country.last_refreshed
           FROM mv_dashboard_stats_by_country
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM mv_dashboard_stats_by_country) AS row_count
WITH DATA;
CREATE UNIQUE INDEX idx_mv_view_refresh_status_pk ON public.mv_view_refresh_status USING btree (view_name);

-- The owner and grants each view had before the DROP, exactly; what default privileges added is taken back first.
DO $$
DECLARE
  v text;
  before_owner oid;
  g record;
  who text;
BEGIN
  FOREACH v IN ARRAY ARRAY['mv_dashboard_stats_by_country', 'mv_view_refresh_status'] LOOP
    SELECT relowner INTO before_owner FROM v1611_views WHERE relname = v;
    IF NOT FOUND THEN
      -- The view did not exist before this file: the grants it has always been created with.
      EXECUTE format('GRANT ALL ON public.%I TO service_role', v);
      EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', v);
      CONTINUE;
    END IF;
    IF (SELECT relowner FROM pg_class WHERE oid = format('public.%I', v)::regclass) <> before_owner THEN
      EXECUTE format('ALTER MATERIALIZED VIEW public.%I OWNER TO %I', v, pg_get_userbyid(before_owner));
    END IF;
    FOR g IN SELECT DISTINCT a.grantee FROM pg_class c, aclexplode(c.relacl) a
              WHERE c.oid = format('public.%I', v)::regclass AND a.grantee <> c.relowner LOOP
      who := CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON public.%I FROM %s', v, who);
    END LOOP;
    FOR g IN SELECT grantee, privilege_type, is_grantable FROM v1611_grants WHERE relname = v LOOP
      who := CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('GRANT %s ON public.%I TO %s%s', g.privilege_type, v, who,
                     CASE WHEN g.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
    END LOOP;
  END LOOP;
END $$;
