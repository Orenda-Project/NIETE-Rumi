-- Rollback for V1.10.6: puts back V1.10.5's teacher_activity_batch (the Coached tile by completed_at).

CREATE OR REPLACE FUNCTION public.teacher_activity_batch(p_user_ids uuid[])
  RETURNS TABLE (user_id uuid, tiles jsonb, journey jsonb, reports jsonb, latest jsonb)
  LANGUAGE sql STABLE SECURITY INVOKER SET statement_timeout = '20s'
  AS $$
  WITH w AS (
    SELECT ((today - 29)::timestamp AT TIME ZONE 'Asia/Karachi') AS now_from,
           ((today - 59)::timestamp AT TIME ZONE 'Asia/Karachi') AS prev_from,
           ((today - 89)::timestamp AT TIME ZONE 'Asia/Karachi') AS trend_from
      FROM (SELECT (now() AT TIME ZONE 'Asia/Karachi')::date AS today) d
  ),
  t AS (SELECT DISTINCT unnest(p_user_ids) AS uid)
  SELECT t.uid,
         jsonb_build_object(
           'plans_opened', jsonb_build_object('now', plans.now_n, 'prev', plans.prev_n),
           'taught', jsonb_build_object('now', taught.now_n, 'prev', taught.prev_n),
           'coached', jsonb_build_object('now', coached.now_n, 'prev', coached.prev_n),
           'quizzes', jsonb_build_object('now', quizzes.now_n, 'prev', quizzes.prev_n),
           'exams', jsonb_build_object('now', exams.now_n, 'prev', exams.prev_n)),
         coalesce(steps.list, '[]'::jsonb),
         coalesce(reps.list, '[]'::jsonb),
         last_report.obj
    FROM t CROSS JOIN w
    -- the lesson plans she used: opened in the app, or received on WhatsApp (lp-history's union), one per plan
    LEFT JOIN LATERAL (
      WITH uses AS (
        SELECT o.plan_kind AS kind, o.plan_ref AS ref, o.opened_at AS at, 'portal' AS via
          FROM niete_lp_opens o WHERE o.user_id = t.uid AND o.opened_at >= w.prev_from
        UNION ALL
        SELECT 'k5', d.lesson_id, d.created_at, 'whatsapp'
          FROM niete_lp_downloads d WHERE d.user_id = t.uid AND d.status = 'sent' AND d.created_at >= w.prev_from
        UNION ALL
        SELECT 'g612', g.segment_id, g.delivered_at, 'whatsapp'
          FROM niete_lp612_deliveries g WHERE g.user_id = t.uid AND g.surface <> 'portal' AND g.delivered_at >= w.prev_from
      )
      SELECT (SELECT count(DISTINCT kind || ':' || ref) FROM uses WHERE at >= w.now_from) AS now_n,
             (SELECT count(DISTINCT kind || ':' || ref) FROM uses WHERE at < w.now_from) AS prev_n,
             (SELECT jsonb_agg(jsonb_build_object('kind', 'plan_opened', 'at', p.at, 'ref_id', p.ref,
                       'meta', jsonb_build_object('plan_kind', p.kind, 'via', p.via)))
                FROM (SELECT DISTINCT ON (kind, ref) kind, ref, at, via FROM uses ORDER BY kind, ref, at DESC) p) AS steps
    ) plans ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE f.created_at >= w.now_from) AS now_n,
             count(*) FILTER (WHERE f.created_at < w.now_from) AS prev_n,
             jsonb_agg(jsonb_build_object('kind', 'taught', 'at', f.created_at, 'ref_id', f.id,
               'meta', jsonb_strip_nulls(jsonb_build_object(
                 'plan_kind', CASE WHEN f.lp612_segment_id IS NOT NULL THEN 'g612' WHEN lp.id IS NOT NULL THEN 'k5' END,
                 'plan_ref', coalesce(f.lp612_segment_id, lp.content -> 'v8' ->> 'lesson_id'),
                 'grade', f.grade, 'subject', f.subject, 'topic', left(f.topic, 120))))) AS steps
        FROM lp_feedback f
        LEFT JOIN lesson_plans lp ON lp.id = f.lesson_plan_id
       WHERE f.user_id = t.uid AND f.used_in_class = 'taught' AND f.created_at >= w.prev_from
    ) taught ON true
    -- her own Digital Coach observations (countsFor's rule, by completed_at); each gives a step, its report a step
    -- (when scored) and its tip a step (when it has one)
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE c.completed_at >= w.now_from) AS now_n,
             count(*) FILTER (WHERE c.completed_at < w.now_from) AS prev_n,
             coalesce(jsonb_agg(jsonb_build_object('kind', 'coached', 'at', c.completed_at, 'ref_id', c.id,
               'meta', jsonb_strip_nulls(jsonb_build_object('topic', left(c.analysis_data ->> 'topic', 120),
                 'subject', c.analysis_data ->> 'subject')))), '[]'::jsonb)
             || coalesce(jsonb_agg(jsonb_build_object('kind', 'report',
               'at', coalesce(c.report_generated_at, c.analysis_completed_at, c.completed_at), 'ref_id', c.id,
               'meta', jsonb_strip_nulls(jsonb_build_object('topic', left(c.analysis_data ->> 'topic', 120),
                 'pct', c.analysis_data -> 'scores' -> 'overall_percentage', 'opened_at', c.coach_report_opened_at))))
               FILTER (WHERE jsonb_typeof(c.analysis_data -> 'scores' -> 'overall_percentage') = 'number'), '[]'::jsonb)
             || coalesce(jsonb_agg(jsonb_build_object('kind', 'tip',
               'at', coalesce(c.report_generated_at, c.analysis_completed_at, c.completed_at), 'ref_id', c.id,
               'meta', jsonb_build_object('text', left(coalesce(c.prioritized_action -> 'thing_to_try' ->> 'text',
                 c.prioritized_action ->> 'action'), 200))))
               FILTER (WHERE coalesce(c.prioritized_action -> 'thing_to_try' ->> 'text', c.prioritized_action ->> 'action', '') <> ''),
               '[]'::jsonb) AS steps
        FROM coaching_sessions c
       WHERE c.user_id = t.uid AND c.status = 'completed' AND c.observation_type IS NULL AND c.completed_at >= w.prev_from
    ) coached ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE q.created_at >= w.now_from) AS now_n,
             count(*) FILTER (WHERE q.created_at < w.now_from) AS prev_n,
             jsonb_agg(jsonb_build_object('kind', 'quiz', 'at', q.created_at, 'ref_id', q.id,
               'meta', jsonb_strip_nulls(jsonb_build_object('topic', left(q.topic, 120), 'grade', q.grade,
                 'subject', q.subject, 'played', q.total_students_completed)))) AS steps
        FROM quizzes q
       WHERE q.teacher_id = t.uid AND q.status IN ('sent', 'report_sent') AND q.created_at >= w.prev_from
    ) quizzes ON true
    -- her papers (the Assessment Generator): one per request that reached a ready root paper, never an edit
    -- (progress.service's rule), dated by the paper
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE e.created_at >= w.now_from) AS now_n,
             count(*) FILTER (WHERE e.created_at < w.now_from) AS prev_n,
             jsonb_agg(jsonb_build_object('kind', 'exam', 'at', e.created_at, 'ref_id', e.id,
               'meta', jsonb_strip_nulls(jsonb_build_object('grade', e.grade_code, 'subject', e.subject_code,
                 'chapter', e.chapter_number)))) AS steps
        FROM (SELECT DISTINCT ON (r.id) p.id, p.created_at, r.grade_code, r.subject_code, r.chapter_number
                FROM assessment_requests r
                JOIN assessment_papers p ON p.request_id = r.id
               WHERE r.user_id = t.uid AND p.status = 'ready' AND p.edited_from IS NULL AND p.created_at >= w.prev_from
               ORDER BY r.id, p.created_at DESC) e
    ) exams ON true
    -- every step in one list, newest first, capped at 200
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(x.step ORDER BY x.at DESC) AS list
        FROM (SELECT s.step, s.at
                FROM (SELECT a.step, (a.step ->> 'at')::timestamptz AS at
                        FROM jsonb_array_elements(coalesce(plans.steps, '[]'::jsonb) || coalesce(taught.steps, '[]'::jsonb)
                               || coached.steps || coalesce(quizzes.steps, '[]'::jsonb)
                               || coalesce(exams.steps, '[]'::jsonb)) a(step)) s
               ORDER BY s.at DESC LIMIT 200) x
    ) steps ON true
    -- her own scored reports in 90 days, newest first: each applicable indicator's 0-2 score (the trend's input)
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(r.obj ORDER BY r.at DESC) AS list
        FROM (SELECT c.completed_at AS at, jsonb_build_object('session_id', c.id, 'at', c.completed_at,
                       'framework', coalesce(c.analysis_data ->> 'framework', c.framework),
                       'indicators', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.value ->> 'id',
                                        'name', i.value ->> 'name', 'score', i.value -> 'score')), '[]'::jsonb)
                                        FROM jsonb_each(c.analysis_data -> 'domains') d,
                                             jsonb_array_elements(CASE WHEN jsonb_typeof(d.value -> 'indicators') = 'array'
                                               THEN d.value -> 'indicators' ELSE '[]'::jsonb END) i
                                       WHERE jsonb_typeof(i.value -> 'score') = 'number'
                                         AND coalesce(i.value ->> 'applicable', 'true') <> 'false')) AS obj
                FROM coaching_sessions c
               WHERE c.user_id = t.uid AND c.status = 'completed' AND c.observation_type IS NULL
                 AND c.completed_at >= w.trend_from AND jsonb_typeof(c.analysis_data -> 'domains') = 'object'
               ORDER BY c.completed_at DESC LIMIT 6) r
    ) reps ON true
    -- her latest own report (any score shape): the "Try next class" tip's source
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('session_id', c.id, 'at', c.completed_at,
               'tip', left(coalesce(c.prioritized_action -> 'thing_to_try' ->> 'text', c.prioritized_action ->> 'action'), 600)) AS obj
        FROM coaching_sessions c
       WHERE c.user_id = t.uid AND c.status = 'completed' AND c.observation_type IS NULL AND c.completed_at >= w.trend_from
       ORDER BY c.completed_at DESC LIMIT 1
    ) last_report ON true
$$;
COMMENT ON FUNCTION public.teacher_activity_batch(uuid[]) IS
  'One row per teacher: Home tiles, journey steps, report indicator scores and the latest tip source, for the twice-a-day activity job (docs/teacher-activity-store.md). Read only; service_role.';
REVOKE ALL ON FUNCTION public.teacher_activity_batch(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_activity_batch(uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';

-- post-flight: SELECT user_id, tiles FROM public.teacher_activity_batch(ARRAY[]::uuid[]);  -- no rows
