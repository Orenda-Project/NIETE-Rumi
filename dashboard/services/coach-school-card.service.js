'use strict';
/**
 * The coach School Card, read side. Behind portal_coach_v2 AND portal_coach_school_card (the routes,
 * dashboard/routes/coach-school-card.routes.js). Nothing is stored; every number is a count of things that
 * happened, read from tables that already exist.
 *
 *   getSchoolCard      one of HER schools for a period: four feature tiles, every teacher with her counts, the
 *                      coach observations per teacher
 *   getSchoolFeature   one feature's grid: a row per teacher, a cell per bucket, the school's row
 *   getTeacherCard     one teacher in HER patch: her tiles, score averages against the period before, her chart
 *   getTeacherItems    her list of one feature's items in the period
 *   getTeacherReports  what her DC reports told her, what went well, scores by report, coach visits
 *   getSession         one DC report of such a teacher, coach view
 *
 * ACCESS. The coach is always the session user. A school must be one of her leader_schools rows (coach-v2's
 * LEADER_SCHOOLS, matched by EMIS the way getCoachSchool matches it); a teacher must be on the roster of one of
 * those schools (the patch rule, leader-patch PATCH_TEACHERS_SQL: whoever has the school has the teacher); a
 * session must be a DC session of such a teacher. Anything else is null, which the route answers as 404.
 *
 * ONE SCHOOL. getCoachSchool reads the coach's whole patch and keeps one school; this reads the one school's
 * roster and then only that roster's rows, bounded by the period.
 *
 * NO TRANSCRIPT. No read selects the lesson's transcript or its speaker turns, and no answer carries them.
 *
 * Every read is tagged `/* sc:<name> *\/` so the tests can answer it at the database boundary. `query` is
 * injected ((sql, params) => Promise<{rows}>), as in every leader-* and coach-* service.
 */

const { getOverall } = require('./coaching-frameworks.service');
const { createScoreMemo } = require('./schools-analytics.service');
const { indicatorsOf, movesOf } = require('./coach-disagreement-evidence');
const { displayNameOf } = require('../../bot/shared/services/observe/patch-resolver.service');
// Pure (no requires): the teacher's report card's own "what went well" and step names.
const { wells, stepOf } = require('../../bot/shared/services/coaching/report-card');
const P = require('../lib/school-card-period');
const { karachiToday } = require('../lib/visit-time');

const FEATURES = Object.freeze(['lp', 'dc', 'training', 'papers']);
const ITEM_FEATURES = Object.freeze(['dc', 'coach', 'lp', 'papers', 'training']);
const HUMAN_OBSERVATION = 'leader_observation';
/** A coach observation that did not happen (coaching-query-rules hitl_conducted). */
const DEAD_VISIT = Object.freeze(['cancelled', 'abandoned', 'failed', 'test_cleanup']);
/** Reviewed by the coach: only then is a visit's score hers (coach-v2 TERMINAL_STATUSES). */
const REVIEWED = Object.freeze(['completed', 'observer_review_complete']);
/** The /observe2 field form's rubric: counted as a visit, never averaged with the FICO form's scores. */
const FIELD_FORM_RUBRIC = 'fico17';
const CD_GROUPS = Object.freeze(['C', 'D']);
const ROSTER_ROLES = `('teacher', 'principal')`;

/** The four FICO sections, in framework order (fico-framework.js DOMAINS; coaching-report-view SECTIONS). */
const SECTIONS = Object.freeze([
  { code: 'B', key: 'lesson_plan_fidelity', name: 'Lesson Plan Fidelity' },
  { code: 'C', key: 'high_leverage_practices', name: 'High-Leverage Practices' },
  { code: 'D', key: 'student_engagement', name: 'Student Engagement' },
  { code: 'F', key: 'teacher_subject_knowledge', name: 'Teacher Subject Knowledge' },
]);

const DAY_MS = 24 * 3600 * 1000;
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v) => (v == null ? null : Math.round(v));
const rowsOf = (res) => (res && Array.isArray(res.rows) ? res.rows : []);
const stamp = (v) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));
const atMs = (v) => Date.parse(stamp(v)) || 0;
const byAt = (a, b) => atMs(a.at) - atMs(b.at);
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
const mean = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
};
const daysAgo = (day, today) => (day ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS)) : null);

// ── SQL ──────────────────────────────────────────────────────────────────────

/** The fields the score read keeps of each section: what sectionPctOf reads, nothing else. */
const SECTION_COLUMNS = SECTIONS.flatMap(({ code, key }) => [['score', 'domain_score'], ['max', 'domain_max'], ['assessed', 'assessed']]
  .map(([col, field]) => `s.a #>> '{domains,${key},${field}}' AS ${code.toLowerCase()}_${col}`));

const VISIT_HAPPENED = `c.observation_type = '${HUMAN_OBSERVATION}'
     AND c.status NOT IN (${DEAD_VISIT.map((s) => `'${s}'`).join(', ')})
     AND c.observer_user_id IS DISTINCT FROM c.user_id
     AND ou.is_test_user IS NOT TRUE`;

const PATCH_HAS_SCHOOL = `EXISTS (SELECT 1 FROM leader_schools lsch
                    WHERE lsch.leader_user_id = $1
                      AND (lsch.school_id = sch.id OR lsch.school_ext_id = 'niete:' || sch.emis))`;

const ROSTER = `u.role IN ${ROSTER_ROLES} AND u.is_test_user IS NOT TRUE AND u.deleted_at IS NULL`;

const SQL = Object.freeze({
  // The access check for a school: her leader_schools row for this EMIS, and the schools rows it covers.
  school: `/* sc:school */
    SELECT DISTINCT sch.id, sch.name, sch.emis, lsch.school_name
      FROM leader_schools lsch
      JOIN schools sch ON lsch.school_id = sch.id OR 'niete:' || sch.emis = lsch.school_ext_id
     WHERE lsch.leader_user_id = $1
       AND (lsch.emis = $2 OR (lsch.emis IS NULL AND lsch.school_ext_id = 'niete:' || $2))`,

  roster: `/* sc:roster */
    SELECT u.id, u.phone_number, u.name, u.role, u.school_id
      FROM users u
     WHERE u.school_id = ANY($1::uuid[]) AND ${ROSTER}`,

  // The access check for a teacher: on the roster of a school she holds.
  teacher: `/* sc:teacher */
    SELECT u.id, u.phone_number, u.name, u.role, u.school_id, u.preferred_language, sch.name AS school_name, sch.emis
      FROM users u JOIN schools sch ON sch.id = u.school_id
     WHERE u.phone_number = $2 AND ${ROSTER} AND ${PATCH_HAS_SCHOOL}
     ORDER BY u.id LIMIT 1`,

  teacherById: `/* sc:teacher-by-id */
    SELECT u.id, u.phone_number, u.name, u.role, u.school_id, u.preferred_language, sch.name AS school_name, sch.emis
      FROM users u JOIN schools sch ON sch.id = u.school_id
     WHERE u.id = $2::uuid AND ${ROSTER} AND ${PATCH_HAS_SCHOOL}
     LIMIT 1`,

  // lesson_plans.created_at is a timestamp WITHOUT time zone holding UTC: compared as naive UTC so its index
  // applies, handed back as an instant. content is opened once (below OFFSET 0) for its two v8 fields.
  lp: `/* sc:lp */
    SELECT x.id, x.user_id, x.at, x.grade, x.subject, x.topic, x.v8 ->> 'surface' AS surface, x.v8 ->> 'lesson_id' AS lesson_id
      FROM (SELECT l.id, l.user_id, (l.created_at AT TIME ZONE 'UTC') AS at, l.grade, l.subject, l.topic, l.content -> 'v8' AS v8
              FROM lesson_plans l
             WHERE l.user_id = ANY($1::uuid[])
               AND l.created_at >= ($2::timestamptz AT TIME ZONE 'UTC')
               AND l.created_at < ($3::timestamptz AT TIME ZONE 'UTC')
            OFFSET 0) x`,

  opens: `/* sc:opens */
    SELECT o.id, o.user_id, o.opened_at AS at, o.plan_ref
      FROM niete_lp_opens o
     WHERE o.user_id = ANY($1::uuid[]) AND o.plan_kind = 'k5' AND o.source = 'viewer'
       AND o.opened_at >= $2::timestamptz AND o.opened_at < $3::timestamptz`,

  // DC and coach observations: ids, dates and flags only (analysis_data is read per session, memoised, below).
  sessions: `/* sc:sessions */
    SELECT c.id, c.user_id, c.created_at AS at, c.updated_at, c.status, c.observation_type, c.duplicate_of_session_id,
           c.observer_user_id, ou.name AS observer_name, (ou.is_test_user IS TRUE) AS observer_test
      FROM coaching_sessions c LEFT JOIN users ou ON ou.id = c.observer_user_id
     WHERE c.user_id = ANY($1::uuid[])
       AND c.created_at >= $2::timestamptz AND c.created_at < $3::timestamptz
       AND (c.observation_type IS NULL OR c.observation_type = '${HUMAN_OBSERVATION}')`,

  // analysis_data detoasted once per session (OFFSET 0, as schools-analytics SCORES_SQL), reduced to a few fields.
  scores: `/* sc:scores */
    SELECT s.id, s.updated_at, s.a -> 'scores' AS scores,
           ${SECTION_COLUMNS.join(',\n           ')},
           s.a ->> 'grade' AS grade, s.a ->> 'subject' AS subject, s.a #>> '{observe2,rubric}' AS rubric
      FROM (SELECT id, updated_at, analysis_data #> '{}'::text[] AS a
              FROM coaching_sessions
             WHERE id = ANY($1::uuid[])
            OFFSET 0) s`,

  lastVisit: `/* sc:last-visit */
    SELECT DISTINCT ON (c.user_id) c.user_id, c.created_at AS at
      FROM coaching_sessions c LEFT JOIN users ou ON ou.id = c.observer_user_id
     WHERE c.user_id = ANY($1::uuid[]) AND ${VISIT_HAPPENED}
     ORDER BY c.user_id, c.created_at DESC`,

  training: `/* sc:training */
    SELECT tp.user_id, tp.module_id, min(tp.completed_at) AS at
      FROM teacher_training_progress tp
     WHERE tp.user_id = ANY($1::uuid[])
       AND tp.completed_at >= $2::timestamptz AND tp.completed_at < $3::timestamptz
     GROUP BY tp.user_id, tp.module_id`,

  // The courses of the given modules, every active part, and when she first finished each.
  courses: `/* sc:courses */
    SELECT m.id AS module_id, m.title AS module_title, m.order_index AS module_order,
           c.id AS course_id, c.title AS course_title, c.order_index AS course_order,
           (SELECT min(tp.completed_at) FROM teacher_training_progress tp
             WHERE tp.user_id = $2::uuid AND tp.module_id = m.id) AS done_at
      FROM training_modules m JOIN training_courses c ON c.id = m.course_id
     WHERE m.is_active AND m.course_id IN (SELECT course_id FROM training_modules WHERE id = ANY($1::bigint[]))`,

  // A request counts once when a ROOT paper (not an edit) of it is ready; the latest ready root gives its size.
  papers: `/* sc:papers */
    SELECT r.id, r.user_id, r.created_at AS at, r.grade_code, r.subject_code,
           p.question_count AS questions, p.total_marks AS marks
      FROM assessment_requests r
      JOIN LATERAL (
        SELECT ap.question_count, ap.total_marks FROM assessment_papers ap
         WHERE ap.request_id = r.id AND ap.edited_from IS NULL AND ap.status = 'ready'
         ORDER BY ap.attempt DESC, ap.created_at DESC
         LIMIT 1
      ) p ON TRUE
     WHERE r.user_id = ANY($1::uuid[])
       AND r.created_at >= $2::timestamptz AND r.created_at < $3::timestamptz`,

  group: `/* sc:group */
    SELECT ab_group FROM niete_coaching_ab_assignment WHERE school_id = $1::uuid`,

  // The step text of each report. The thing to try leaves the database only for a C or D school ($2).
  actions: `/* sc:actions */
    SELECT c.id, c.prioritized_action ->> 'action' AS action,
           CASE WHEN $2::text IN ('C', 'D') THEN c.prioritized_action #>> '{thing_to_try,text}' END AS thing_text,
           c.analysis_data #>> '{focus_area,try_this_tomorrow}' AS focus_try
      FROM coaching_sessions c
     WHERE c.id = ANY($1::uuid[])`,

  strengths: `/* sc:strengths */
    SELECT s.id, s.a -> 'strengths' AS strengths, s.a #> '{lp_fidelity,strengths}' AS lp_strengths,
           s.a -> 'report_narrative' AS narrative
      FROM (SELECT id, analysis_data #> '{}'::text[] AS a
              FROM coaching_sessions
             WHERE id = ANY($1::uuid[])
            OFFSET 0) s`,

  session: `/* sc:session */
    SELECT id, user_id, created_at, status, observation_type, duplicate_of_session_id,
           analysis_data, prioritized_action, conversation_state
      FROM coaching_sessions
     WHERE id = $1::uuid`,
});

// ── the counting definitions (one function each) ─────────────────────────────

const PLAN_REF_RX = /^grade_(\d+)_(.+?)_ch\d+_seg/;

/**
 * LESSON PLANS. The RDF's lp_use (routine-data-flow rdf_niete/lp_use.py with_app_opens; the same rule
 * schools-analytics teachersSql counts as lpsUsed), with ONE change so repeat requests do not inflate it:
 *   - per teacher and Pakistan day, a WhatsApp plan (a lesson_plans row that is not content.v8.surface 'app') is
 *     counted once per PLAN — the plan is content.v8.lesson_id (the menu's lesson), else the row itself (a typed
 *     plan is its own) — where the RDF counts every row, so the same lesson asked for twice that day is one;
 *   - on a teacher-day with no WhatsApp plan, one per distinct plan read in the teacher app: an app-surface
 *     lesson_plans row and a K-5 viewer open of the same plan are one (the RDF's (teacher, day, plan) key);
 *   - a day that has a WhatsApp plan takes nothing from the app (the RDF's `have` rule).
 * The same plan on another day counts again, as the RDF counts an app plan again on another day.
 * App opens count with source 'viewer' only (governed lp-query-rules §8; the RDF takes every k5 open).
 * Grade 6-12 lessons are not lesson-plan rows in the RDF's lp_use, so they are not counted here.
 *
 * @param {Array<{id, user_id, at, surface, lesson_id, grade, subject, topic}>} rows lesson_plans in the window
 * @param {Array<{id, user_id, at, plan_ref}>} opens niete_lp_opens k5 viewer opens in the window
 * @returns {Array<{id, userId, day, at, ref, grade, subject, title}>} one entry per plan counted
 */
function lessonPlansOf(rows = [], opens = []) {
  const wa = [];
  const app = [];
  for (const r of rows) {
    const day = P.pkDayOf(r.at);
    if (!day || !r.user_id) continue;
    (r.surface === 'app' ? app : wa).push({ ...r, day });
  }
  const have = new Set(wa.map((r) => `${r.user_id}|${r.day}`));
  const seen = new Set();
  const out = [];
  const add = (key, plan) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(plan);
  };
  const fromRow = (r) => ({
    id: r.id, userId: r.user_id, day: r.day, at: r.at, ref: r.lesson_id || `row:${r.id}`,
    grade: text(r.grade), subject: text(r.subject), title: text(r.topic),
  });
  for (const r of wa.sort(byAt)) add(`wa|${r.user_id}|${r.day}|${r.lesson_id || `row:${r.id}`}`, fromRow(r));
  for (const r of app.sort(byAt)) {
    if (have.has(`${r.user_id}|${r.day}`)) continue;
    add(`app|${r.user_id}|${r.day}|${r.lesson_id || `row:${r.id}`}`, fromRow(r));
  }
  for (const o of [...opens].sort(byAt)) {
    const day = P.pkDayOf(o.at);
    if (!day || !o.user_id || have.has(`${o.user_id}|${day}`)) continue;
    const m = PLAN_REF_RX.exec(String(o.plan_ref || ''));
    add(`app|${o.user_id}|${day}|${o.plan_ref}`, {
      id: `open:${o.id}`, userId: o.user_id, day, at: o.at, ref: o.plan_ref,
      grade: m ? m[1] : null, subject: m ? m[2] : null, title: null,
    });
  }
  return out;
}

/**
 * DC OBSERVATIONS. A teacher's own recording (observation_type null) that finished (status 'completed') with an
 * overall score, and is not a re-send of an earlier recording (duplicate_of_session_id null).
 * Governed dc_complete counts scored sessions whatever their status and keeps the re-sends; schools-analytics
 * counts every 'completed' one, re-sends and unscored included. The re-send carries the earlier report's score,
 * so counting it would count one lesson twice.
 */
function isDcObservation(row, pct) {
  return !!row && row.observation_type == null && row.status === 'completed'
    && !row.duplicate_of_session_id && typeof pct === 'number' && Number.isFinite(pct);
}

/**
 * COACH OBSERVATIONS. A coach's visit (observation_type 'leader_observation') by any coach, that happened: not
 * cancelled, abandoned, failed or a test clean-up, not a self-observation, and not by a test account — the governed
 * hitl_conducted rule without its "scores present" test, so a visit still being analysed already counts.
 * Its score is the coach's reviewed score, so only a REVIEWED visit has one; a /observe2 field-form visit
 * (rubric fico17) is counted and listed but never averaged or drawn with the FICO form's scores.
 */
function isCoachObservation(row) {
  return !!row && row.observation_type === HUMAN_OBSERVATION && row.status != null && !DEAD_VISIT.includes(row.status)
    && row.observer_user_id !== row.user_id && row.observer_test !== true;
}
const isFieldForm = (info) => !!info && info.rubric === FIELD_FORM_RUBRIC;
const visitScore = (row, scored) => (row && REVIEWED.includes(row.status) && scored ? round(scored.pct) : null);

/**
 * TRAINING PARTS. Distinct modules she finished in the period (teacher_training_progress holds completions only;
 * governed training §2 and schools-analytics both count DISTINCT (user, module)), each on its first day.
 */
function trainingPartsOf(rows = []) {
  const first = new Map();
  for (const r of rows) {
    const day = P.pkDayOf(r.at);
    if (!day || !r.user_id || r.module_id == null) continue;
    const k = `${r.user_id}|${r.module_id}`;
    if (!first.has(k) || day < first.get(k).day) first.set(k, { userId: r.user_id, moduleId: Number(r.module_id), day, at: r.at });
  }
  return [...first.values()];
}

/**
 * PAPERS. Her Assessment Generator requests in the period that reached a ready ROOT paper (governed exam rules
 * §2/§3a: never count assessment_papers rows, an edit is not a new paper, status 'ready' on the root is the test).
 * A retry is another paper row of the same request, so a request counts once. The read (SQL.papers) returns one
 * row per such request; this dates each one.
 */
function papersOf(rows = []) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const day = P.pkDayOf(r.at);
    if (!day || !r.user_id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, userId: r.user_id, day, at: r.at, grade: text(r.grade_code), subject: text(r.subject_code), questions: num(r.questions), marks: num(r.marks) });
  }
  return out;
}

/** DAYS WITH ANY NIETE USE. Distinct Pakistan school days (Mon-Fri) in the period with any of the four features. */
function daysWithUse(period, events) {
  const days = new Set();
  for (const e of events) if (P.inPeriod(period, e.day) && P.isSchoolDay(e.day)) days.add(e.day);
  return days.size;
}

/**
 * CONTRIBUTION %. Her total of the four feature counts over the school's total, × 100, rounded; equal weights.
 * Only for a teacher with a total above 0. A constructed metric (v1 default): kept in this one function.
 */
function contributionPct(total, schoolTotal) {
  if (!(total > 0) || !(schoolTotal > 0)) return null;
  return Math.round((total / schoolTotal) * 100);
}

/** ★ Top contributor: a total above 0 that fewer than two teachers beat (a tie for second place shares it). */
function starsOf(teachers) {
  const totals = teachers.map((t) => t.total);
  return totals.map((t) => t > 0 && totals.filter((x) => x > t).length < 2);
}

/**
 * THE NEXT STEP SHE WAS SHOWN (the v10 coaching test). Her report image showed prioritized_action.action as the
 * one thing to try next class (report-generator: the commitment card's action, hero-report tryNext). A C or D school
 * got the slim card and the /cr page instead, which show prioritized_action.thing_to_try.text when it has words,
 * else that same action (slim-report.js, coaching-report-view.js thing()). thing_to_try is stored for A and B too,
 * as the comparison, but never shown to them, so a coach at an A, B or undrawn school must never see it.
 * @param {object|null} pa prioritized_action
 * @param {'A'|'B'|'C'|'D'|null} group her school's niete_coaching_ab_assignment.ab_group
 */
function nextStepShown(pa, group) {
  const p = pa && typeof pa === 'object' ? pa : {};
  if (CD_GROUPS.includes(group)) {
    const t = text(p.thing_to_try && p.thing_to_try.text);
    if (t) return t;
  }
  return text(p.action);
}

// ── reads ────────────────────────────────────────────────────────────────────

const defaultMemo = createScoreMemo();
const createMemo = () => createScoreMemo();

function sectionPctOf(score, max, assessed) {
  if (assessed === false || assessed === 'false') return null;
  const s = num(score);
  const m = num(max);
  return s != null && m && m > 0 ? Math.round((s / m) * 100) : null;
}

function infoOf(r) {
  const sections = {};
  for (const { code } of SECTIONS) {
    const k = code.toLowerCase();
    sections[code] = sectionPctOf(r[`${k}_score`], r[`${k}_max`], r[`${k}_assessed`]);
  }
  return { sections, grade: text(r.grade), subject: text(r.subject), rubric: text(r.rubric) };
}

function overallOf(scores) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return null;
  const o = getOverall({ scores });
  if (o.percentage == null || !Number.isFinite(o.percentage) || !Number.isFinite(o.maxPoints) || o.maxPoints <= 0) return null;
  return o.percentage;
}

/** id → { pct, info } for these sessions, through the per-process memo (a session's score rarely changes). */
async function scoresFor(query, sessions, memo) {
  const out = new Map();
  const toRead = [];
  for (const s of sessions) {
    const hit = memo.get(s.id, stamp(s.updated_at));
    if (hit) out.set(s.id, { pct: hit.pct, info: hit.sections });
    else toRead.push(s.id);
  }
  if (toRead.length) {
    for (const r of rowsOf(await query(SQL.scores, [toRead]))) {
      const entry = { pct: overallOf(r.scores), info: infoOf(r) };
      memo.set(r.id, stamp(r.updated_at), entry.pct, entry.info);
      out.set(r.id, entry);
    }
  }
  return out;
}

async function groupOf(query, schoolId) {
  if (!schoolId) return null;
  try {
    const g = text((rowsOf(await query(SQL.group, [schoolId]))[0] || {}).ab_group);
    return ['A', 'B', 'C', 'D'].includes(g) ? g : null;
  } catch (err) {
    // An unreadable group is an undrawn school: the report's own action, never the thing to try. Logged, because
    // a C/D coach would then see the action instead of what her teacher was shown.
    console.error('coach/school-card: v10 group read failed, showing the report action:', err && err.message);
    return null;
  }
}

/** Her school(s) for this EMIS and their roster, or null when the EMIS is not one of hers. */
async function schoolContext(query, coachId, emis) {
  if (!coachId || !emis) return null;
  const schools = rowsOf(await query(SQL.school, [coachId, String(emis)]));
  if (!schools.length) return null;
  const ids = [...new Set(schools.map((s) => s.id))];
  const roster = rowsOf(await query(SQL.roster, [ids]));
  const seen = new Set();
  const teachers = roster.filter((u) => !seen.has(u.id) && seen.add(u.id)).map((u) => ({
    id: u.id, teacherExtId: u.phone_number, name: displayNameOf(u), isPrincipal: u.role === 'principal',
  }));
  return {
    school: { emis: String(emis), name: text(schools[0].school_name) || text(schools[0].name), ids },
    teachers,
  };
}

async function teacherOf(query, coachId, ext) {
  if (!coachId || !ext) return null;
  const u = rowsOf(await query(SQL.teacher, [coachId, String(ext)]))[0];
  return u ? { ...u, displayName: displayNameOf(u) } : null;
}

/**
 * Everything the four features and the coach observations need for these teachers: one read per table, bounded
 * by the window, then the scores of the sessions that can count. `sessionsRange` widens the session read (the
 * teacher card's previous period).
 */
async function loadActivity(query, ids, range, { memo, sessionsRange } = {}) {
  const empty = { plans: [], parts: [], papers: [], sessions: [], scored: new Map() };
  if (!ids.length) return empty;
  const b = P.boundsOf(range);
  const sb = P.boundsOf(sessionsRange || range);
  // At most three reads at once per request: portal outages have been pool exhaustion (schools-analytics header).
  const [lp, opens, sessions] = await Promise.all([
    query(SQL.lp, [ids, b.fromTs, b.toTs]),
    query(SQL.opens, [ids, b.fromTs, b.toTs]),
    query(SQL.sessions, [ids, sb.fromTs, sb.toTs]),
  ]);
  const [training, papers] = await Promise.all([
    query(SQL.training, [ids, b.fromTs, b.toTs]),
    query(SQL.papers, [ids, b.fromTs, b.toTs]),
  ]);
  const rows = rowsOf(sessions).map((s) => ({ ...s, day: P.pkDayOf(s.at) })).filter((s) => s.day);
  const candidates = rows.filter((s) => (s.observation_type == null
    ? s.status === 'completed' && !s.duplicate_of_session_id
    : isCoachObservation(s)));
  const scored = await scoresFor(query, candidates, memo || defaultMemo);
  return {
    plans: lessonPlansOf(rowsOf(lp), rowsOf(opens)),
    parts: trainingPartsOf(rowsOf(training)),
    papers: papersOf(rowsOf(papers)),
    sessions: rows,
    scored,
  };
}

/** The four features as dated events { userId, day, at, ... } (DC: only those that count). */
function featureEvents(act) {
  const pctOf = (s) => (act.scored.get(s.id) || {}).pct;
  return {
    lp: act.plans,
    dc: act.sessions.filter((s) => isDcObservation(s, pctOf(s))).map((s) => ({ ...s, userId: s.user_id })),
    training: act.parts,
    papers: act.papers,
  };
}

function tally(period, events, userIds) {
  const width = period.buckets.length;
  const per = new Map(userIds.map((id) => [id, { total: 0, cells: Array(width).fill(0) }]));
  for (const e of events) {
    const t = per.get(e.userId);
    if (!t || !P.inPeriod(period, e.day)) continue;
    t.total += 1;
    const i = P.bucketIndexOf(period, e.day);
    if (i >= 0) t.cells[i] += 1;
  }
  return per;
}

function resolvePeriod(opts) {
  return P.periodOf(P.parsePeriodKey(opts.period) || 'week', opts.today || karachiToday());
}

async function lastVisits(query, ids) {
  if (!ids.length) return new Map();
  return new Map(rowsOf(await query(SQL.lastVisit, [ids])).map((r) => [r.user_id, P.pkDayOf(r.at)]));
}

/** Coach observations per teacher in the period: count, the reviewed FICO-form scores oldest first, latest, change. */
function coachVisitsOf(period, act, teachers) {
  const out = [];
  for (const t of teachers) {
    const visits = act.sessions.filter((s) => s.user_id === t.id && P.inPeriod(period, s.day) && isCoachObservation(s)).sort(byAt);
    if (!visits.length) continue;
    const points = visits.map((s) => {
      const scored = act.scored.get(s.id);
      const score = isFieldForm(scored && scored.info) ? null : visitScore(s, scored);
      return score == null ? null : { date: s.day, score };
    }).filter(Boolean);
    const latest = points.length ? points[points.length - 1].score : null;
    out.push({
      teacherExtId: t.teacherExtId,
      name: t.name,
      count: visits.length,
      points,
      latest,
      change: points.length >= 2 ? latest - points[0].score : null,
    });
  }
  return out.sort((a, b) => (b.count - a.count) || byName(a, b));
}

// ── the endpoints ────────────────────────────────────────────────────────────

/** GET /school/:emis/card */
async function getSchoolCard(query, coachId, emis, opts = {}) {
  const ctx = await schoolContext(query, coachId, emis);
  if (!ctx) return null;
  const period = resolvePeriod(opts);
  const ids = ctx.teachers.map((t) => t.id);
  const act = await loadActivity(query, ids, period, opts);
  const last = await lastVisits(query, ids);
  const events = featureEvents(act);
  const tallies = Object.fromEntries(FEATURES.map((f) => [f, tally(period, events[f], ids)]));

  const tiles = FEATURES.map((feature) => {
    const per = [...tallies[feature].values()];
    const total = per.reduce((s, t) => s + t.total, 0);
    return {
      feature,
      total,
      makers: per.filter((t) => t.total > 0).length,
      // "about N a day": the total over the school days so far, rounded (0 with a total above 0 reads
      // "less than 1 a day"); Today shows no rate.
      perDay: period.key === 'today' || !period.schoolDaysSoFar ? null : Math.round(total / period.schoolDaysSoFar),
      series: period.buckets.map((_, i) => per.reduce((s, t) => s + t.cells[i], 0)),
    };
  });

  const rows = ctx.teachers.map((t) => {
    const counts = Object.fromEntries(FEATURES.map((f) => [f, tallies[f].get(t.id).total]));
    return { t, counts, total: FEATURES.reduce((s, f) => s + counts[f], 0) };
  }).sort((a, b) => (b.total - a.total) || byName(a.t, b.t));
  const schoolTotal = rows.reduce((s, r) => s + r.total, 0);
  const stars = starsOf(rows);
  const teacherDays = ctx.teachers.map((t) => last.get(t.id)).filter(Boolean).sort();
  const schoolLast = teacherDays.length ? teacherDays[teacherDays.length - 1] : null;

  return {
    school: { emis: ctx.school.emis, name: ctx.school.name, teachers: ctx.teachers.length, lastVisitDaysAgo: daysAgo(schoolLast, period.today) },
    period: P.publicPeriod(period),
    tiles,
    teachers: rows.map((r, i) => ({
      teacherExtId: r.t.teacherExtId,
      name: r.t.name,
      isPrincipal: r.t.isPrincipal,
      counts: r.counts,
      total: r.total,
      contributionPct: contributionPct(r.total, schoolTotal),
      star: stars[i],
      lastVisitDaysAgo: daysAgo(last.get(r.t.id), period.today),
    })),
    coachObservations: (() => {
      const teachers = coachVisitsOf(period, act, ctx.teachers);
      return { count: teachers.reduce((s, t) => s + t.count, 0), teachers };
    })(),
  };
}

/** GET /school/:emis/feature/:feature */
async function getSchoolFeature(query, coachId, emis, feature, opts = {}) {
  if (!FEATURES.includes(feature)) return null;
  const ctx = await schoolContext(query, coachId, emis);
  if (!ctx) return null;
  const period = resolvePeriod(opts);
  const ids = ctx.teachers.map((t) => t.id);
  const act = await loadActivity(query, ids, period, opts);
  const per = tally(period, featureEvents(act)[feature], ids);
  const rows = ctx.teachers.map((t) => ({ teacherExtId: t.teacherExtId, name: t.name, cells: per.get(t.id).cells, total: per.get(t.id).total }))
    .sort((a, b) => (b.total - a.total) || byName(a, b));
  return {
    feature,
    period: P.publicPeriod(period),
    rows,
    school: period.buckets.map((_, i) => rows.reduce((s, r) => s + r.cells[i], 0)),
    total: rows.reduce((s, r) => s + r.total, 0),
  };
}

/** Her courses touched by these modules: every active part with her first done day, and whether all are done. */
async function coursesOf(query, userId, moduleIds) {
  if (!moduleIds.length) return [];
  const rows = rowsOf(await query(SQL.courses, [moduleIds, userId]));
  const byCourse = new Map();
  for (const r of rows) {
    if (!byCourse.has(r.course_id)) byCourse.set(r.course_id, { name: text(r.course_title), order: num(r.course_order) || 0, parts: [] });
    byCourse.get(r.course_id).parts.push({ name: text(r.module_title), order: num(r.module_order) || 0, doneAt: P.pkDayOf(r.done_at) });
  }
  return [...byCourse.values()].sort((a, b) => a.order - b.order).map((c) => {
    const parts = c.parts.sort((a, b) => a.order - b.order).map(({ name, doneAt }) => ({ name, doneAt }));
    const done = parts.length > 0 && parts.every((p) => p.doneAt);
    return { name: c.name, done, parts, lastDone: done ? parts.map((p) => p.doneAt).sort().pop() : null };
  });
}

/** Her activity for the period (sessions also for the period before), shaped once for her card, lists and reports. */
async function teacherActivity(query, teacher, opts) {
  const period = resolvePeriod(opts);
  const prev = P.previousOf(period);
  const act = await loadActivity(query, [teacher.id], period, { ...opts, sessionsRange: { from: prev.from, to: period.to } });
  const events = featureEvents(act);
  const inP = (s) => P.inPeriod(period, s.day);
  const inPrev = (s) => s.day >= prev.from && s.day <= prev.to;
  const dc = events.dc.slice().sort(byAt);
  const visits = act.sessions.filter(isCoachObservation).sort(byAt);
  return { period, prev, act, events, dc, visits, inP, inPrev };
}

const pctOfSession = (act, s) => round((act.scored.get(s.id) || {}).pct);
const ficoVisitScore = (act, s) => {
  const scored = act.scored.get(s.id);
  return isFieldForm(scored && scored.info) ? null : visitScore(s, scored);
};

/** GET /teacher/:ext/card */
async function getTeacherCard(query, coachId, ext, opts = {}) {
  const teacher = await teacherOf(query, coachId, ext);
  if (!teacher) return null;
  const { period, act, events, dc, visits, inP, inPrev } = await teacherActivity(query, teacher, opts);
  const ids = [teacher.id];
  const series = (list) => tally(period, list, ids).get(teacher.id);
  const tile = (list) => { const t = series(list); return { count: t.total, series: t.cells }; };
  const periodVisits = visits.filter(inP).map((s) => ({ ...s, userId: s.user_id }));
  const courses = await coursesOf(query, teacher.id, [...new Set(events.training.filter((p) => P.inPeriod(period, p.day)).map((p) => p.moduleId))]);
  const trn = series(events.training);

  const chart = [
    ...dc.filter(inP).map((s) => ({ kind: 'dc', id: s.id, at: s.at, date: s.day, score: pctOfSession(act, s) })),
    ...visits.filter(inP).map((s) => ({ kind: 'coach', id: s.id, at: s.at, date: s.day, score: ficoVisitScore(act, s) })),
  ].filter((p) => p.score != null).sort(byAt).map(({ at, ...p }) => p);

  return {
    teacher: { teacherExtId: teacher.phone_number, name: teacher.displayName, school: text(teacher.school_name), emis: teacher.emis == null ? null : String(teacher.emis) },
    period: P.publicPeriod(period),
    tiles: {
      lp: tile(events.lp),
      papers: tile(events.papers),
      dc: tile(dc),
      coach: tile(periodVisits),
      training: { parts: trn.total, courses: courses.filter((c) => c.done && P.inPeriod(period, c.lastDone)).length, series: trn.cells },
      aiScore: { avg: mean(dc.filter(inP).map((s) => pctOfSession(act, s))), prevAvg: mean(dc.filter(inPrev).map((s) => pctOfSession(act, s))) },
      coachScore: { avg: mean(visits.filter(inP).map((s) => ficoVisitScore(act, s))), prevAvg: mean(visits.filter(inPrev).map((s) => ficoVisitScore(act, s))) },
      days: { withUse: daysWithUse(period, [...events.lp, ...dc, ...events.training, ...events.papers]), schoolDays: period.schoolDaysSoFar },
    },
    chart,
  };
}

const newestFirst = (a, b) => atMs(b.at) - atMs(a.at);
const formOf = (act, s) => (isFieldForm((act.scored.get(s.id) || {}).info) ? 'observe2' : 'v3');

/** GET /teacher/:ext/items/:feature */
async function getTeacherItems(query, coachId, ext, feature, opts = {}) {
  if (!ITEM_FEATURES.includes(feature)) return null;
  const teacher = await teacherOf(query, coachId, ext);
  if (!teacher) return null;
  const { period, act, events, dc, visits, inP } = await teacherActivity(query, teacher, opts);
  const base = { feature, period: P.publicPeriod(period) };
  const info = (s) => (act.scored.get(s.id) || {}).info || {};
  const inPeriodOnly = (list) => list.filter((e) => P.inPeriod(period, e.day)).sort(newestFirst);
  switch (feature) {
    case 'dc':
      return { ...base, items: dc.filter(inP).sort(newestFirst).map((s) => ({ sessionId: s.id, date: s.day, grade: info(s).grade || null, subject: info(s).subject || null, aiScore: pctOfSession(act, s) })) };
    case 'coach':
      return { ...base, items: visits.filter(inP).sort(newestFirst).map((s) => ({ id: s.id, date: s.day, coachName: text(s.observer_name), score: visitScore(s, act.scored.get(s.id)), form: formOf(act, s) })) };
    case 'lp':
      return { ...base, items: inPeriodOnly(events.lp).map((p) => ({ id: p.id, date: p.day, grade: p.grade, subject: p.subject, title: p.title })) };
    case 'papers':
      return { ...base, items: inPeriodOnly(events.papers).map((p) => ({ id: p.id, date: p.day, grade: p.grade, subject: p.subject, questions: p.questions, marks: p.marks })) };
    default: {
      const moduleIds = [...new Set(inPeriodOnly(events.training).map((p) => p.moduleId))];
      const courses = await coursesOf(query, teacher.id, moduleIds);
      return { ...base, courses: courses.map(({ name, parts, done }) => ({ name, done, parts })) };
    }
  }
}

const STRENGTH_REPORTS = 3;

/** The language her report was written in: the narrative's own, else her preference. */
function languageOf(narrative, teacher) {
  const l = (narrative && narrative._language) || (teacher && teacher.preferred_language);
  return l === 'ur' ? 'ur' : 'en';
}

/** GET /teacher/:ext/reports */
async function getTeacherReports(query, coachId, ext, opts = {}) {
  const teacher = await teacherOf(query, coachId, ext);
  if (!teacher) return null;
  const { period, act, dc, visits, inP } = await teacherActivity(query, teacher, opts);
  const reports = dc.filter(inP).sort(newestFirst);
  const coachVisits = visits.filter(inP).sort(newestFirst);
  const group = await groupOf(query, teacher.school_id);
  const actionIds = [...reports, ...coachVisits].map((s) => s.id);
  const strengthIds = reports.slice(0, STRENGTH_REPORTS).map((s) => s.id);
  const [actionRes, strengthRes] = await Promise.all([
    actionIds.length ? query(SQL.actions, [actionIds, group]) : { rows: [] },
    strengthIds.length ? query(SQL.strengths, [strengthIds]) : { rows: [] },
  ]);
  const actions = new Map(rowsOf(actionRes).map((r) => [r.id, r]));
  const strengths = new Map(rowsOf(strengthRes).map((r) => [r.id, r]));
  const info = (s) => (act.scored.get(s.id) || {}).info || {};
  const tag = (s) => ({ grade: info(s).grade || null, subject: info(s).subject || null });
  const noSections = { B: null, C: null, D: null, F: null };

  return {
    period: P.publicPeriod(period),
    nextSteps: reports.map((s) => {
      const a = actions.get(s.id) || {};
      const t = nextStepShown({ action: a.action, thing_to_try: { text: a.thing_text } }, group);
      return t ? { sessionId: s.id, date: s.day, ...tag(s), text: t } : null;
    }).filter(Boolean),
    strengths: reports.slice(0, STRENGTH_REPORTS).map((s) => {
      const r = strengths.get(s.id) || {};
      const a = { strengths: r.strengths, lp_fidelity: { strengths: r.lp_strengths }, report_narrative: r.narrative };
      const texts = wells(a, languageOf(r.narrative, teacher), r.narrative);
      return texts.length ? { sessionId: s.id, date: s.day, ...tag(s), text: texts[0], texts } : null;
    }).filter(Boolean),
    scores: [
      ...reports.map((s) => ({ kind: 'dc', id: s.id, at: s.at, date: s.day, overall: pctOfSession(act, s), sections: { ...noSections, ...info(s).sections }, form: null })),
      ...coachVisits.map((s) => {
        const score = visitScore(s, act.scored.get(s.id));
        return { kind: 'coach', id: s.id, at: s.at, date: s.day, overall: score, sections: score == null ? { ...noSections } : { ...noSections, ...info(s).sections }, form: formOf(act, s) };
      }),
    ].sort(newestFirst).map(({ at, ...r }) => r),
    coachVisits: coachVisits.map((s) => {
      const a = actions.get(s.id) || {};
      return { id: s.id, date: s.day, score: visitScore(s, act.scored.get(s.id)), step: text(a.action) || text(a.focus_try), form: formOf(act, s) };
    }),
  };
}

/** A section's scale: its stored maximum over the practices it scored, else the framework's own scale. */
function scaleMaxOf(domain) {
  const max = num(domain && domain.domain_max);
  const n = num(domain && domain.indicators_applicable);
  if (max && n && n > 0 && Number.isInteger(max / n)) return max / n;
  try {
    return require('../../bot/shared/services/coaching/frameworks/fico-framework').getScoringConstants().scaleMax;
  } catch (_) {
    return null;
  }
}

const practiceOrder = (id) => {
  const m = /(\d+)\s*$/.exec(String(id || ''));
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

/** GET /session/:id — one DC report of a teacher in her patch, coach view. */
async function getSession(query, coachId, sessionId, opts = {}) {
  let row = rowsOf(await query(SQL.session, [sessionId]))[0];
  if (!row || row.observation_type != null || !row.user_id) return null;
  const teacher = rowsOf(await query(SQL.teacherById, [coachId, row.user_id]))[0];
  if (!teacher) return null;
  // A re-send reused an earlier report: open that one (hers too, and a DC session).
  if (row.duplicate_of_session_id) {
    const orig = rowsOf(await query(SQL.session, [row.duplicate_of_session_id]))[0];
    if (orig && orig.user_id === row.user_id && orig.observation_type == null) row = orig;
  }
  const group = await groupOf(query, teacher.school_id);
  const a = row.analysis_data && typeof row.analysis_data === 'object' ? row.analysis_data : {};
  const domains = a.domains && typeof a.domains === 'object' ? a.domains : {};
  const narrative = a.report_narrative || null;
  const moves = movesOf(a);
  const questions = (row.conversation_state && Array.isArray(row.conversation_state.questions)) ? row.conversation_state.questions : [];

  return {
    sessionId: row.id,
    teacher: { teacherExtId: teacher.phone_number, name: displayNameOf(teacher) },
    date: P.pkDayOf(row.created_at),
    grade: a.grade == null || a.grade === '' ? null : String(a.grade),
    subject: text(a.subject),
    overall: round(overallOf(a.scores)),
    whatWentWell: wells(a, languageOf(narrative, teacher), narrative),
    nextStep: nextStepShown(row.prioritized_action, group),
    sections: SECTIONS.filter((s) => domains[s.key]).map((s) => ({
      code: s.code, name: s.name, pct: sectionPctOf(domains[s.key].domain_score, domains[s.key].domain_max, domains[s.key].assessed),
    })),
    practices: indicatorsOf(a).flatMap((sec) => {
      const code = (SECTIONS.find((s) => s.key === sec.key) || {}).code || null;
      const scaleMax = scaleMaxOf(domains[sec.key]);
      return sec.items.filter((i) => i.id)
        .sort((x, y) => practiceOrder(x.id) - practiceOrder(y.id))
        .map((i) => ({ id: i.id, name: i.name, section: code, score: i.score, scaleMax }));
    }),
    lpSteps: moves ? moves.map((m) => {
      const step = stepOf(m.phase);
      return { step: step ? step.name : null, verdict: m.verdict, text: m.text, mustHappen: m.mustHappen };
    }) : null,
    reflection: questions.filter((q) => q && text(q.answer)).map((q) => ({ question: text(q.question), answer: text(q.answer) })),
  };
}

module.exports = {
  FEATURES,
  ITEM_FEATURES,
  SQL,
  createMemo,
  lessonPlansOf,
  isDcObservation,
  isCoachObservation,
  trainingPartsOf,
  papersOf,
  daysWithUse,
  contributionPct,
  starsOf,
  nextStepShown,
  getSchoolCard,
  getSchoolFeature,
  getTeacherCard,
  getTeacherItems,
  getTeacherReports,
  getSession,
};
