/**
 * bd-2387 — Leader "patch" resolver.
 *
 * A leader's patch is the set of teachers migrated into Rumi at `leader_teachers`
 * (keyed by leader_user_id = the portal session user id; teacher_phone_e164 is
 * the normalised PK number). Each patch teacher is LEFT JOINed to their Rumi
 * `users` row by phone, plus lifetime coaching/LP counts and the latest
 * completed session's analysis_data — so we can show an at-a-glance score.
 * Teachers not yet on Rumi still appear (onRumi:false) so a leader sees their
 * WHOLE patch, not just the active subset.
 *
 * The last score is normalised across frameworks in JS via getOverall (HOTS /
 * OECD / MEWAKA all store scores under different keys) — that logic can't live
 * in SQL because analysis_data is per-framework JSONB.
 *
 * `query` is injected (sig: (sql, params) => Promise<{rows}>) so this is
 * unit-testable without a live DB; production wires it to the pg pool.
 */

const { getOverall } = require('./coaching-frameworks.service');
// The one name chain, shared with the bot rather than re-derived here. That
// module is pure — no supabase, no env — so requiring it from the dashboard is
// safe, and it is the only way the two surfaces cannot drift apart. The measured
// reasoning for the ORDER of the chain lives beside fullNameOf.
const {
  fullNameOf, displayNameOf,
} = require('../../bot/shared/services/observe/patch-resolver.service');

// One round-trip. LATERALs return 0 / no rows for teachers with no Rumi user,
// so the LEFT JOINs yield 0 counts / null score for off-Rumi teachers.
// bd-2671: a leader observation NEVER reaches status='completed' — live
// 2026-08-13, of 85 observations ever created: observer_review_complete 53,
// awaiting_observer_review 17, failed 12, completed 1. The old query counted
// and scored only status='completed', so the entire observation programme was
// invisible in teacher performance. TERMINAL is the shared definition, and it
// matches isCompleted() in leader-observations.service.js.
// bd-2672: school name + EMIS come from leader_schools (already populated:
// 433 rows) — no new tables, no new columns.
const TERMINAL = `('completed', 'observer_review_complete')`;

const PATCH_TEACHERS_SQL = `
  SELECT DISTINCT ON (u.id)
    u.phone_number        AS teacher_ext_id,
    -- The three name columns, resolved in JS by fullNameOf. This used to be
    -- the first name alone, and 210 rows carry a blank first name — 57
    -- of them teachers with a school, i.e. inside somebody's patch — so those
    -- people reached the coach's list as a row with no name on it at all. Her
    -- counts were right; there was nothing to recognise her by, which reads
    -- exactly like "she is not in the data", and that is how it was reported.
    u.first_name          AS first_name,
    u.last_name           AS last_name,
    u.name                AS name,
    u.phone_number        AS phone,
    'niete:' || sch.emis  AS school_ext_id,
    u.role                AS role,
    u.id                  AS rumi_user_id,
    u.first_name          AS rumi_first_name,
    COALESCE(cc.n, 0)     AS coaching_sessions,
    COALESCE(obs.n, 0)    AS observations,
    COALESCE(lpc.plans, 0) AS lesson_plans,
    ls.analysis_data      AS last_analysis_data,
    ls.created_at         AS last_session_at,
    sch.name              AS school_name
  -- The patch is DERIVED: whoever has the school has the teacher (operator,
  -- 2026-08-28). leader_teachers stored this and disagreed with users.school_id
  -- on 230 rows; a join cannot disagree with itself.
  -- DISTINCT ON because two of a coach's school_ext_ids can resolve to one
  -- schools row (niete:607 covers two real schools in the register).
  FROM leader_schools lsch
  JOIN schools sch
    ON lsch.school_id = sch.id OR 'niete:' || sch.emis = lsch.school_ext_id
  JOIN users u
    ON u.school_id = sch.id
   AND u.role IN ('teacher', 'principal')
  LEFT JOIN LATERAL (
    SELECT count(*) AS n
    FROM coaching_sessions c
    WHERE c.user_id = u.id
      AND c.status IN ${TERMINAL}
      AND c.observation_type IS DISTINCT FROM 'leader_observation'
  ) cc ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n
    FROM coaching_sessions c
    WHERE c.user_id = u.id
      AND c.status IN ${TERMINAL}
      AND c.observation_type = 'leader_observation'
  ) obs ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS plans
    FROM lesson_plans l
    WHERE l.user_id = u.id
  ) lpc ON true
  LEFT JOIN LATERAL (
    SELECT analysis_data, created_at
    FROM coaching_sessions c
    WHERE c.user_id = u.id AND c.status IN ${TERMINAL} AND c.analysis_data IS NOT NULL
    ORDER BY c.created_at DESC
    LIMIT 1
  ) ls ON true
  WHERE lsch.leader_user_id = $1
  ORDER BY u.id, u.first_name ASC
`;

/** EMIS is the suffix of school_ext_id ('niete:509' → '509'). */
function emisOf(schoolExtId) {
  if (!schoolExtId) return null;
  const s = String(schoolExtId);
  const code = s.includes(':') ? s.slice(s.lastIndexOf(':') + 1) : s;
  return code.trim() || null;
}

/**
 * bd-2672: name the focus area rather than flagging that one exists. The
 * analysis carries it as focus_area (legacy alias focus_area_sw) with the
 * human text in title/title_sw and an id like "C3.7" in indicator.
 */
function focusAreaOf(analysis) {
  const f = (analysis && (analysis.focus_area || analysis.focus_area_sw)) || null;
  if (!f) return null;
  return f.title || f.title_sw || f.indicator || null;
}

function shapeTeacher(r) {
  const onRumi = !!r.rumi_user_id;
  const overall = onRumi && r.last_analysis_data ? getOverall(r.last_analysis_data) : null;
  const resolvedName = fullNameOf(r);
  return {
    teacherExtId: r.teacher_ext_id || null,
    // Never blank. `displayNameOf` returns her real name whenever one resolves
    // and otherwise a LABEL — her role plus the last four digits of the number
    // this very payload already carries in full below. No name is invented, and
    // `hasName` says which of the two this is, so a consumer that needs to know
    // can ask instead of guessing from the shape of the string.
    name: displayNameOf(r),
    hasName: resolvedName != null,
    phone: r.phone || null,
    onRumi,
    rumiUserId: r.rumi_user_id || null,
    coachingSessions: Number(r.coaching_sessions) || 0,
    // bd-2671: observations are counted separately — they are a different act
    // (a coach visited her) from a self-recorded coaching session.
    observations: Number(r.observations) || 0,
    lessonPlans: Number(r.lesson_plans) || 0,
    lastSessionAt: r.last_session_at || null,
    // percentage is the framework-agnostic headline; null when never coached.
    lastScore: overall && overall.percentage != null ? overall.percentage : null,
    focusArea: onRumi ? focusAreaOf(r.last_analysis_data) : null,
    schoolName: r.school_name || null,
    emis: emisOf(r.school_ext_id),
    // 354 principals join patches that never had them. An unlabelled principal
    // in a teacher list is how the wrong person gets observed.
    isPrincipal: r.role === 'principal',
  };
}

/**
 * @param {(sql: string, params: any[]) => Promise<{rows: object[]}>} query
 * @param {string} leaderUserId  portal session user id (leader_teachers.leader_user_id)
 * @returns {Promise<object[]>}  shaped patch teachers, sorted by name
 */
async function getPatchTeachers(query, leaderUserId) {
  const { rows } = await query(PATCH_TEACHERS_SQL, [leaderUserId]);
  return (rows || []).map(shapeTeacher);
}

module.exports = { getPatchTeachers, PATCH_TEACHERS_SQL };
