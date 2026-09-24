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

// bd-60117: the projection and the four stat LATERALs are shared by BOTH entry
// points below (coach-by-leader_schools, principal-by-users.school_id). They are
// one constant rather than two copies because the moment a stat is defined twice
// the two definitions start to drift, and "the principal's numbers disagree with
// the coach's numbers for the same teacher" is an unfalsifiable bug report.
const PATCH_SELECT = `
  SELECT DISTINCT ON (u.id)
    u.phone_number        AS teacher_ext_id,
    -- The three name columns, resolved in JS by fullNameOf. This used to be
    -- the first name alone, and 210 rows carry a blank first name — 57
    -- of them teachers with a school, i.e. inside somebody's patch — so those
    -- people reached the coach's list as a row with no name on it at all. Her
    -- counts were right; there was nothing to recognise her by, which reads
    -- exactly like "she is not in the data", and that is how it was reported.
    u.name                AS name,
    u.phone_number        AS phone,
    'niete:' || sch.emis  AS school_ext_id,
    u.role                AS role,
    u.id                  AS rumi_user_id,
    u.name          AS rumi_first_name,
    COALESCE(cc.n, 0)     AS coaching_sessions,
    COALESCE(obs.n, 0)    AS observations,
    COALESCE(lpc.plans, 0) AS lesson_plans,
    ls.analysis_data      AS last_analysis_data,
    ls.created_at         AS last_session_at,
    sch.name              AS school_name,
    -- the two features the row could not previously speak for. The
    -- principal is asked to track her teachers feature by feature, so every
    -- feature needs a number here or the view cannot be organised by one.
    COALESCE(att.n, 0)    AS attendance_sessions,
    COALESCE(trn.n, 0)    AS training_modules
`;

// The four per-person stat LATERALs. Identical for every caller: they key on
// u.id alone, so they do not care how u was reached.
const PATCH_LATERALS = `
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
  -- registers SHE took, keyed on user_id. Deliberately NOT
  -- teacher_attendance_records, which is somebody marking HER present — a
  -- different question, a different key (teacher_id), and counting it here
  -- would report her own presence as her use of the feature.
  LEFT JOIN LATERAL (
    SELECT count(*) AS n
    FROM attendance_sessions a
    WHERE a.user_id = u.id
  ) att ON true
  -- modules COMPLETED, counted DISTINCT. Assignment is not
  -- engagement — 89 people were assigned I-SAPS on prod and 88 could not reach
  -- it, so counting teacher_training_assignments would report a busy school in
  -- which nothing happened.
  --
  -- Two things measured on prod 2026-09-22 rather than assumed. First,
  -- completed_at is non-null on all 706,892 rows: this table only ever records
  -- a completion, so the IS NOT NULL guard below is belt-and-braces against a
  -- future nullable write, not a filter that does work today. Second, the
  -- heaviest user holds 130 rows over 130 DISTINCT modules against a 438-module
  -- catalogue — so there is no duplicate-row inflation to correct for, and
  -- DISTINCT is what keeps it that way if a module is ever re-completed.
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT tp.module_id) AS n
    FROM teacher_training_progress tp
    WHERE tp.user_id = u.id
      AND tp.completed_at IS NOT NULL
  ) trn ON true
`;

// ── entry point 1: a COACH, via her school assignments ──────────────────────
// The patch is DERIVED: whoever has the school has the teacher (operator,
// 2026-08-28). leader_teachers stored this and disagreed with users.school_id
// on 230 rows; a join cannot disagree with itself.
// DISTINCT ON because two of a coach's school_ext_ids can resolve to one
// schools row (niete:607 covers two real schools in the register).
const PATCH_TEACHERS_SQL = `${PATCH_SELECT}
  FROM leader_schools lsch
  JOIN schools sch
    ON lsch.school_id = sch.id OR 'niete:' || sch.emis = lsch.school_ext_id
  JOIN users u
    ON u.school_id = sch.id
   AND u.role IN ('teacher', 'principal')
${PATCH_LATERALS}
  WHERE lsch.leader_user_id = $1
  ORDER BY u.id, u.name ASC
`;

// ── entry point 2: a PRINCIPAL, via her OWN users.school_id ─────────────────
// bd-60117. A principal is tied to her school by users.school_id and holds no
// leader_schools row — only 24 of 460 did on prod 2026-09-17, so the other 436
// fell through the coach query's WHERE and saw an empty My Patch. Nothing
// errored; the roster was simply blank, which is why it went unreported as a
// bug and got read as "there is no data for my school".
//
// So she is found by her own id, her school is read off her own row, and the
// roster is everyone at that school. `me` is a separate scan of users rather
// than a self-join on the roster: she must resolve even when she is somehow not
// in her own school's roster, otherwise the failure mode is the silent-empty
// one all over again.
//
// The role guard on `me` matters as much as the school join. Without it any
// leader-family user with a school_id would silently get a one-school patch
// instead of their real multi-school one, which is a wrong answer wearing the
// clothes of a right one. principals only, by decision — coaches keep entry
// point 1, and the other three leader roles are multi-school by nature.
const PRINCIPAL_PATCH_SQL = `${PATCH_SELECT}
  FROM users me
  JOIN schools sch
    ON sch.id = me.school_id
  JOIN users u
    ON u.school_id = sch.id
   AND u.role IN ('teacher', 'principal')
${PATCH_LATERALS}
  WHERE me.id = $1
    AND me.role = 'principal'
  ORDER BY u.id, u.name ASC
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
    // per-feature engagement for the principal's landing view.
    // `|| 0` is load-bearing: a caller on a stale deploy sends no such column,
    // and Number(undefined) is NaN, which renders as a broken tile.
    attendanceSessions: Number(r.attendance_sessions) || 0,
    trainingModules: Number(r.training_modules) || 0,
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
 * Which query answers "who is in this person's patch", given their role.
 *
 * bd-60117: a principal's patch is her own school (users.school_id); everyone
 * else's is their school assignments (leader_schools). Unknown/absent role
 * falls back to the coach path — that is what every caller got before this
 * existed, so an un-passed role cannot change an existing answer.
 */
function patchSqlFor(role) {
  const r = role == null ? null : String(role).trim().toLowerCase();
  return r === 'principal' ? PRINCIPAL_PATCH_SQL : PATCH_TEACHERS_SQL;
}

/**
 * @param {(sql: string, params: any[]) => Promise<{rows: object[]}>} query
 * @param {string} leaderUserId  portal session user id
 * @param {{role?: string}} [opts]  the caller's users.role — decides the entry
 *   point. Omit it and you get the coach path, as before.
 * @returns {Promise<object[]>}  shaped patch teachers, sorted by name
 */
async function getPatchTeachers(query, leaderUserId, opts = {}) {
  const { rows } = await query(patchSqlFor(opts.role), [leaderUserId]);
  return (rows || []).map(shapeTeacher);
}

module.exports = {
  getPatchTeachers,
  patchSqlFor,
  PATCH_TEACHERS_SQL,
  PRINCIPAL_PATCH_SQL,
  TERMINAL,
};
