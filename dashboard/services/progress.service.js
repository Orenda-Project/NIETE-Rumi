'use strict';
/**
 * bd-5rz1v.17 (server half) — the new Home: "what you did" for a date range, as five counts, and
 * the list behind each one.
 *
 * Activity, not ratings (design v6, Home): the tiles are counts; a rating appears only inside the
 * coaching list, and there only as a band (score-bands.js — never a number).
 *
 * EACH COUNT, EXACTLY
 * -------------------
 * All windows are Pakistan days [from, to], inclusive, either end open (pk-range.js).
 *
 *   lessonPlans.used      distinct plans (k5:<lesson_id> | g612:<segment_id>) she opened in the
 *                         portal (niete_lp_opens) or received on WhatsApp (niete_lp_downloads
 *                         'sent', niete_lp612_deliveries) in the window. `opened` and `received`
 *                         split it by way (a plan used both ways is in both, once in `used`);
 *                         `days` = distinct Pakistan days with any use. lp-activity.service.js.
 *   training.completed    teacher_training_progress rows completed in the window on a module that
 *                         is still active — the dashboard stat's rule (INSERT-only table: a row IS
 *                         a completion; UNIQUE (user, module), so a module counts once).
 *   coaching              what her Coaching list shows (teacher-observation LISTED_FOR_TEACHER_SQL):
 *                         her own sessions once completed, and a coach's or principal's observation
 *                         once it was SENT to her (whatever its status) — analysed, dated by
 *                         created_at. `digitalCoach` = her own; `observations` = leader_observation.
 *   assessments.made      papers she generated that finished: assessment_papers 'ready' and NOT an
 *                         edit (edited_from IS NULL — V1.5.6 made an edit a new row, a version of
 *                         the same paper), dated by the paper's created_at. countOutputs (the
 *                         Analytics page) counts every ready row, edits included; it predates
 *                         versions.
 *   attendance.days       distinct register dates (attendance_sessions.session_date) she MARKED
 *                         for her classes. Days, because a teacher marks one register per class per
 *                         day and two classes on one day is still one day of marking; `registers`
 *                         (class-days) is returned beside it. Her OWN presence (teacher_attendance_
 *                         records, marked by her principal) is not something she marked, so it is
 *                         not here.
 *
 * ONE ROUND TRIP. The five counts come from one statement — the Home is the most-loaded page and
 * the portal pool is shared by every request — and every subquery is a per-teacher index scan.
 */

const TeacherObservation = require('../lib/teacher-observation');
const { getOverall } = require('./coaching-frameworks.service');
const { scoreBandFor } = require('../../bot/shared/config/score-bands');
const { pkInstantWindow, dateWindow } = require('../lib/pk-range');
const LpActivity = require('./lp-activity.service');

const METRICS = Object.freeze(['lesson-plans', 'coaching', 'training', 'assessments', 'attendance']);
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;

// ─── one WHERE per count, shared by the count and its list ──────────────────

const COACHING_FROM = 'FROM coaching_sessions c';
const COACHING_WHERE = `c.user_id = $1::uuid
     AND c.analysis_data IS NOT NULL
     AND ${TeacherObservation.listedForTeacherSql('c')}
     AND ${pkInstantWindow('c.created_at', '$2', '$3')}`;
const IS_OBSERVATION = `c.observation_type = '${TeacherObservation.OBSERVATION_TYPE}'`;

const TRAINING_FROM = `FROM teacher_training_progress p
    JOIN training_modules m ON m.id = p.module_id`;
const TRAINING_WHERE = `p.user_id = $1::uuid AND m.is_active
     AND ${pkInstantWindow('p.completed_at', '$2', '$3')}`;

const PAPERS_FROM = `FROM assessment_requests r
    JOIN assessment_papers ap ON ap.request_id = r.id`;
const PAPERS_WHERE = `r.user_id = $1::uuid AND ap.status = 'ready' AND ap.edited_from IS NULL
     AND ${pkInstantWindow('ap.created_at', '$2', '$3')}`;

const ATTENDANCE_FROM = 'FROM attendance_sessions s';
const ATTENDANCE_WHERE = `s.user_id = $1::uuid AND ${dateWindow('s.session_date', '$2', '$3')}`;

/** $1 teacher, $2/$3 Pakistan dates (NULL = open). */
const COUNTS_SQL = `
  WITH ${LpActivity.ACTIVITY_CTE}
  SELECT
    ${LpActivity.COUNT_COLUMNS},
    (SELECT count(*) ${TRAINING_FROM} WHERE ${TRAINING_WHERE}) AS training_completed,
    (SELECT count(*) FILTER (WHERE c.observation_type IS DISTINCT FROM '${TeacherObservation.OBSERVATION_TYPE}')
       ${COACHING_FROM} WHERE ${COACHING_WHERE}) AS coaching_digital,
    (SELECT count(*) FILTER (WHERE ${IS_OBSERVATION})
       ${COACHING_FROM} WHERE ${COACHING_WHERE}) AS coaching_observations,
    (SELECT count(*) ${PAPERS_FROM} WHERE ${PAPERS_WHERE}) AS assessments_made,
    (SELECT count(DISTINCT s.session_date) ${ATTENDANCE_FROM} WHERE ${ATTENDANCE_WHERE}) AS attendance_days,
    (SELECT count(*) ${ATTENDANCE_FROM} WHERE ${ATTENDANCE_WHERE}) AS attendance_registers`;

const n = (v) => Number(v) || 0;

/**
 * The five counts for one teacher over one resolved range.
 * @param {(sql: string, params: any[]) => Promise<{rows: any[]}>} query
 * @param {string} userId  the SESSION's user id
 * @param {{from: string|null, to: string|null}} range  from pk-range.resolveRange
 */
async function progressCounts(query, userId, range) {
  const { rows } = await query(COUNTS_SQL, [userId, range.from, range.to]);
  const r = (rows && rows[0]) || {};
  const digitalCoach = n(r.coaching_digital);
  const observations = n(r.coaching_observations);
  return {
    lessonPlans: { used: n(r.lp_used), opened: n(r.lp_opened), received: n(r.lp_received), days: n(r.lp_days) },
    training: { completed: n(r.training_completed) },
    coaching: { total: digitalCoach + observations, digitalCoach, observations },
    assessments: { made: n(r.assessments_made) },
    attendance: { days: n(r.attendance_days), registers: n(r.attendance_registers), unit: 'days' },
  };
}

/** The tile's number, for a list's `total`. */
function totalFor(metric, counts) {
  switch (metric) {
    case 'lesson-plans': return counts.lessonPlans.used;
    case 'coaching': return counts.coaching.total;
    case 'training': return counts.training.completed;
    case 'assessments': return counts.assessments.made;
    default: return counts.attendance.days;
  }
}

// ─── the lists ──────────────────────────────────────────────────────────────

const ROLES = new Set(['coach', 'principal']);

async function coachingItems(query, userId, range, limit) {
  // The scores SLICE, never the whole analysis_data (~30 KB a row; Class R).
  const { rows } = await query(`
    SELECT c.id, c.created_at, c.observation_type,
           c.analysis_data->'scores' AS scores,
           c.analysis_data->>'topic' AS topic,
           c.analysis_data->>'subject' AS subject,
           o.name AS observer_name, o.role AS observer_role
      ${COACHING_FROM}
      LEFT JOIN users o ON o.id = c.observer_user_id AND ${IS_OBSERVATION}
     WHERE ${COACHING_WHERE}
     ORDER BY c.created_at DESC
     LIMIT $4`, [userId, range.from, range.to, limit]);
  return (rows || []).map((r) => {
    const observation = r.observation_type === TeacherObservation.OBSERVATION_TYPE;
    const overall = r.scores ? getOverall({ scores: r.scores }) : null;
    const scored = overall && overall.percentage != null && overall.maxPoints > 0;
    const role = observation ? String(r.observer_role || '').trim().toLowerCase() : null;
    return {
      id: r.id,
      date: new Date(r.created_at).toISOString(),
      kind: observation ? 'observation' : 'digital_coach',
      observerRole: observation ? (ROLES.has(role) ? role : 'other') : null,
      observerName: observation ? (String(r.observer_name || '').trim() || null) : null,
      // A band, never a number (operator, 2026-09-29); her own sessions are rated too, as on
      // her Analytics page (rateDigital).
      band: scored ? scoreBandFor(overall.percentage) : null,
      topic: r.topic || null,
      subject: r.subject || null,
    };
  });
}

async function trainingItems(query, userId, range, limit) {
  const { rows } = await query(`
    SELECT p.module_id, p.completed_at, m.title AS module_title, tc.title AS course_title
      ${TRAINING_FROM}
      LEFT JOIN training_courses tc ON tc.id = m.course_id
     WHERE ${TRAINING_WHERE}
     ORDER BY p.completed_at DESC NULLS LAST
     LIMIT $4`, [userId, range.from, range.to, limit]);
  return (rows || []).map((r) => ({
    moduleId: String(r.module_id),
    title: r.module_title || null,
    courseTitle: r.course_title || null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
  }));
}

async function assessmentItems(query, userId, range, limit) {
  const { rows } = await query(`
    SELECT ap.id AS paper_id, r.grade_code, r.subject_code, r.chapter_number, ap.created_at
      ${PAPERS_FROM}
     WHERE ${PAPERS_WHERE}
     ORDER BY ap.created_at DESC
     LIMIT $4`, [userId, range.from, range.to, limit]);
  return (rows || []).map((r) => ({
    // The id GET /api/portal/assessment/paper/:paper_id/download takes.
    paperId: r.paper_id,
    grade: Number(String(r.grade_code || '').replace(/^grade_/, '')) || null,
    subjectKey: r.subject_code || null,
    chapterNumber: r.chapter_number ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

async function attendanceItems(query, userId, range, limit) {
  const { rows } = await query(`
    SELECT s.session_date::text AS date, count(*) AS registers,
           array_agg(DISTINCT COALESCE(sl.class_name, 'Unnamed class') ORDER BY COALESCE(sl.class_name, 'Unnamed class')) AS classes
      ${ATTENDANCE_FROM}
      LEFT JOIN student_lists sl ON sl.id = s.list_id
     WHERE ${ATTENDANCE_WHERE}
     GROUP BY s.session_date
     ORDER BY s.session_date DESC
     LIMIT $4`, [userId, range.from, range.to, limit]);
  return (rows || []).map((r) => ({ date: r.date, registers: n(r.registers), classes: r.classes || [] }));
}

/**
 * The items behind one tile, for the same range, with the tile's own number as `total` (so the
 * tile and the list it opens cannot disagree about how many there are).
 * @param {{ limit?: number, describe?: Function }} opts  describe = LpCatalogue.describePlans
 */
async function progressList(query, userId, metric, range, opts = {}) {
  if (!METRICS.includes(metric)) throw new Error(`unknown metric ${metric}`);
  const limit = Math.min(LIST_LIMIT_MAX, Math.max(1, Number(opts.limit) || LIST_LIMIT_DEFAULT));
  const counts = await progressCounts(query, userId, range);
  let items;
  switch (metric) {
    case 'lesson-plans':
      items = await LpActivity.plansUsed(query, userId, {
        from: range.from, to: range.to, limit, describe: opts.describe,
      });
      break;
    case 'coaching': items = await coachingItems(query, userId, range, limit); break;
    case 'training': items = await trainingItems(query, userId, range, limit); break;
    case 'assessments': items = await assessmentItems(query, userId, range, limit); break;
    default: items = await attendanceItems(query, userId, range, limit);
  }
  const total = totalFor(metric, counts);
  return { metric, total, truncated: total > items.length, items };
}

module.exports = {
  METRICS,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  progressCounts,
  progressList,
};
