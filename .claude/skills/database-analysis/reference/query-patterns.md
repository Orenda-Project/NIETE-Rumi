# Database Query Patterns

All queries use a **read-only** role. Always filter `WHERE COALESCE(is_test_user, false) = false`.
These run against the base tables; adapt table/column names to your deployment's schema
([infrastructure/supabase/00_complete-schema.sql](../../../../infrastructure/supabase/00_complete-schema.sql)).

## User growth & registration

```sql
-- Daily new users (last 30 days)
SELECT DATE(created_at) AS day, COUNT(*) AS new_users,
       COUNT(*) FILTER (WHERE registration_completed) AS registered
FROM users
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND COALESCE(is_test_user, false) = false
GROUP BY DATE(created_at) ORDER BY day;

-- Users by country (first two digits of the phone number)
SELECT LEFT(phone_number, 2) AS country_code, COUNT(*) AS users
FROM users
WHERE COALESCE(is_test_user, false) = false
GROUP BY LEFT(phone_number, 2) ORDER BY users DESC;
```

## Engagement & activity

```sql
-- Daily active users (last 30 days)
SELECT DATE(c.created_at) AS day, COUNT(DISTINCT c.user_id) AS dau
FROM conversations c
JOIN users u ON c.user_id = u.id
WHERE c.created_at >= NOW() - INTERVAL '30 days'
  AND c.role = 'user'
  AND COALESCE(u.is_test_user, false) = false
GROUP BY DATE(c.created_at) ORDER BY day;

-- Session length distribution
SELECT CASE
    WHEN message_count <= 2 THEN '1-2 msgs'
    WHEN message_count <= 5 THEN '3-5 msgs'
    WHEN message_count <= 10 THEN '6-10 msgs'
    WHEN message_count <= 20 THEN '11-20 msgs'
    ELSE '20+ msgs' END AS bucket,
  COUNT(*) AS sessions
FROM chat_sessions
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY MIN(message_count);
```

## Feature usage

```sql
-- Feature usage summary (last 30 days). Adjust the UNION arms to the features your deployment runs.
SELECT 'Lesson Plans' AS feature, COUNT(*) AS count
FROM lesson_plan_requests
WHERE created_at >= NOW() - INTERVAL '30 days' AND status = 'completed'
UNION ALL
SELECT 'Coaching', COUNT(*) FROM coaching_sessions
WHERE created_at >= NOW() - INTERVAL '30 days' AND status = 'completed'
UNION ALL
SELECT 'Reading Assessments', COUNT(*) FROM reading_assessments
WHERE created_at >= NOW() - INTERVAL '30 days' AND status = 'completed'
ORDER BY count DESC;

-- Feature adoption per user
SELECT u.id, u.first_name, u.school_name,
  (SELECT COUNT(*) FROM lesson_plan_requests lpr WHERE lpr.user_id = u.id) AS lesson_plans,
  (SELECT COUNT(*) FROM coaching_sessions cs WHERE cs.user_id = u.id) AS coaching,
  (SELECT COUNT(*) FROM reading_assessments ra WHERE ra.user_id = u.id) AS reading
FROM users u
WHERE u.registration_completed = true
  AND COALESCE(u.is_test_user, false) = false
ORDER BY lesson_plans + coaching + reading DESC
LIMIT 50;
```

## Reading assessment analysis

```sql
-- WCPM distribution by grade and language
SELECT language, grade_level, passage_type,
       COUNT(*) AS assessments,
       ROUND(AVG(wcpm), 1) AS avg_wcpm,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wcpm), 1) AS median_wcpm
FROM reading_assessments
WHERE status = 'completed' AND wcpm IS NOT NULL
GROUP BY language, grade_level, passage_type
ORDER BY language, grade_level;
```

## Coaching analysis

```sql
-- Completion rate
SELECT status, COUNT(*) AS count,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) AS pct
FROM coaching_sessions
GROUP BY status ORDER BY count DESC;

-- Average session duration
SELECT ROUND(AVG(audio_duration_seconds) / 60.0, 1) AS avg_minutes
FROM coaching_sessions
WHERE status = 'completed' AND audio_duration_seconds > 0;
```

## Retention cohort (base tables, no MV required)

```sql
WITH user_cohorts AS (
  SELECT id, DATE_TRUNC('week', created_at)::date AS cohort_week
  FROM users WHERE COALESCE(is_test_user, false) = false
),
weekly_activity AS (
  SELECT DISTINCT c.user_id, DATE_TRUNC('week', c.created_at)::date AS active_week
  FROM conversations c WHERE c.role = 'user'
)
SELECT uc.cohort_week,
       COUNT(DISTINCT uc.id) AS cohort_size,
       COUNT(DISTINCT CASE WHEN wa.active_week = uc.cohort_week      THEN uc.id END) AS week0,
       COUNT(DISTINCT CASE WHEN wa.active_week = uc.cohort_week + 7  THEN uc.id END) AS week1,
       COUNT(DISTINCT CASE WHEN wa.active_week = uc.cohort_week + 14 THEN uc.id END) AS week2
FROM user_cohorts uc
LEFT JOIN weekly_activity wa ON wa.user_id = uc.id
GROUP BY uc.cohort_week ORDER BY uc.cohort_week DESC LIMIT 12;
```

## Language distribution

```sql
SELECT preferred_language, COUNT(*) AS users,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) AS pct
FROM users
WHERE COALESCE(is_test_user, false) = false
GROUP BY preferred_language ORDER BY users DESC;
```

## Troubleshooting

- **"permission denied for table X" on SELECT**: your role lacks read grants on that table — grant `SELECT` to the read-only role, or use a role that has it.
- **Materialized views show stale data**: they refresh on a schedule, not live — check your deployment's refresh status before trusting them.
- **Slow queries**: bound by `created_at >= NOW() - INTERVAL '30 days'`, use `LIMIT`, prefer materialized views, and check indexes with `\di`.
