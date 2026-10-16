-- ROLLBACK V1.6.11 — mv_dashboard_stats_by_country back to its definition before V1.6.11 (verbatim, from the live
-- sandbox DB, 2026-10-16): the lesson-plan figure counts every lesson_plan_requests row again, over the per-user
-- join. mv_view_refresh_status, the unique indexes and the grants are recreated as they were. Idempotent.

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

GRANT ALL ON public.mv_dashboard_stats_by_country, public.mv_view_refresh_status TO service_role;
GRANT SELECT ON public.mv_dashboard_stats_by_country, public.mv_view_refresh_status TO anon, authenticated;
