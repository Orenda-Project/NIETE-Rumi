-- V1.6.11 — the NIETE dashboard's lesson-plan figure on the lifecycle definition, and no per-user fan-out
--
-- mv_dashboard_stats_by_country (the portal's country stats, refreshed CONCURRENTLY every 5 minutes) counted lesson
-- plans as COUNT(DISTINCT id) over users LEFT JOINed with lesson_plan_requests, coaching_sessions,
-- reading_assessments and video_requests at once: every teacher's rows multiplied (lesson-plan rows x coaching
-- rows x ...) before the DISTINCT collapsed them. With LP_LIFECYCLE_PATHS on, every lesson-plan path writes a row
-- per ask — about ten times today's rows — which multiplies that product, and the figure would start counting
-- asks that never delivered (failed, refused, a re-fetch that failed).
--
-- Each activity table is now counted per user before the join: the other figures are identical, the fan-out is
-- gone. The lesson-plan figure keeps every row asked before the lifecycle (source IS NULL) exactly as before — a
-- database where the switch was never on shows the same number — and counts a lifecycle row once it was
-- delivered (delivered_at IS NOT NULL), the "delivered" every lesson-plan figure uses.
--
-- Everything else is as it was, taken from the live definition: the other two parts of the view, its columns,
-- order and types, its unique index, its grants, and mv_view_refresh_status (which reads it), dropped and
-- recreated verbatim. Created WITH DATA: the portal's REFRESH ... CONCURRENTLY needs it populated and indexed.
-- Needs V1.6.4 (lesson_plan_requests.source, delivered_at) and refuses without it, changing nothing — the file is
-- one exec_sql call, so any error undoes all of it. Idempotent. Rollback: ROLLBACK_V1.6.11__lp_dashboard_figure.sql.

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'lesson_plan_requests'
         AND column_name IN ('source', 'delivered_at')) <> 2 THEN
    RAISE EXCEPTION 'V1.6.11 needs V1.6.4 (lesson_plan_requests.source and delivered_at): apply V1.6.4 first';
  END IF;
END $$;

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
            COALESCE(sum(lp.n), 0::numeric)::bigint AS lesson_plans,
            COALESCE(sum(cs.n), 0::numeric)::bigint AS coaching_sessions,
            COALESCE(sum(ra.n), 0::numeric)::bigint AS reading_assessments,
            COALESCE(sum(vr.n), 0::numeric)::bigint AS video_requests
           FROM users u
             LEFT JOIN ( SELECT lesson_plan_requests.user_id, count(*) AS n
                           FROM lesson_plan_requests
                          WHERE lesson_plan_requests.source IS NULL OR lesson_plan_requests.delivered_at IS NOT NULL
                          GROUP BY lesson_plan_requests.user_id) lp ON lp.user_id = u.id
             LEFT JOIN ( SELECT coaching_sessions.user_id, count(*) AS n
                           FROM coaching_sessions
                          GROUP BY coaching_sessions.user_id) cs ON cs.user_id = u.id
             LEFT JOIN ( SELECT reading_assessments.user_id, count(*) AS n
                           FROM reading_assessments
                          GROUP BY reading_assessments.user_id) ra ON ra.user_id = u.id
             LEFT JOIN ( SELECT video_requests.user_id, count(*) AS n
                           FROM video_requests
                          GROUP BY video_requests.user_id) vr ON vr.user_id = u.id
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

COMMENT ON MATERIALIZED VIEW public.mv_dashboard_stats_by_country IS
  'Country stats for the NIETE portal, refreshed concurrently every 5 minutes. total_lesson_plans = '
  'lesson_plan_requests rows asked before the lifecycle (source IS NULL) + lifecycle asks delivered '
  '(delivered_at IS NOT NULL). Activity tables are counted per user before the join (V1.6.11).';
