'use strict';
/**
 * The coach School Card, read side. Behind portal_coach_v2 AND portal_coach_school_card (the routes,
 * dashboard/routes/coach-school-card.routes.js). Nothing is stored; every number is a count of things that
 * happened, read from tables that already exist.
 *
 *   getSchoolCard      one of HER schools for a period: four feature tiles, every teacher with her counts, the
 *                      coach observations per teacher
 *   getSchoolFeature   one feature's grid: a row per teacher, a cell per bucket, the school's row
 *   getTeacherCard     one teacher in HER patch: her tiles, and the Coaching summary and chart (the card that opens
 *                      her Coaching page)
 *   getTeacherItems    her list of lesson plans, papers or training in the period
 *   getTeacherScores   her DC reports OR her coach observations on their own: count, average against the period
 *                      before, each report's score, every practice averaged across her reports, the reports
 *   getSchoolScores    the school's DC reports OR coach observations by teacher: count, average, each report's score
 *   getSession         one DC report or coach observation of such a teacher, coach view
 *
 * ACCESS. The coach is always the session user. A school must be one of her leader_schools rows (coach-v2's
 * LEADER_SCHOOLS, matched by EMIS the way getCoachSchool matches it); a teacher must be on the roster of one of
 * those schools (the patch rule, leader-patch PATCH_TEACHERS_SQL: whoever has the school has the teacher); a
 * session must be a DC session of such a teacher. Anything else is null, which the route answers as 404.
 *
 * ONE SCHOOL. getCoachSchool reads the coach's whole patch and keeps one school; this reads the one school's
 * roster and then only that roster's rows, bounded by the period.
 *
 * TEACHING LEVEL (bd-ewbzns.1). `opts.level` (PRIMARY | MIDDLE | HIGH) keeps the school's teachers who teach at it, read
 * from users.teacher_level by the bot's one reader (utils/teacher-level), and every number on the school's pages is
 * then theirs. A teacher of two levels is under each; one with no level recorded is only in the whole school. An
 * unknown level is the whole school. `levels` counts the whole roster at each level, for the chips.
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
const { teacherLevelOf, VALID_LEVELS } = require('../../bot/shared/utils/teacher-level');
// Pure (no requires): the teacher's report card's own "what went well" and step names.
const { wells, stepOf } = require('../../bot/shared/services/coaching/report-card');
const P = require('../lib/school-card-period');
const { karachiToday } = require('../lib/visit-time');

const FEATURES = Object.freeze(['lp', 'dc', 'training', 'papers']);
/** The two kinds of scored observation: a DC report (the AI score) and a coach observation (the Coach score). */
const SCORE_KINDS = Object.freeze(['dc', 'coach']);
/** Her own lists. DC observations and coach visits are not among them: they are the one Coaching list. */
const ITEM_FEATURES = Object.freeze(['lp', 'papers', 'training']);
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
    SELECT u.id, u.phone_number, u.name, u.role, u.school_id, u.teacher_level
      FROM users u
     WHERE u.school_id = ANY($1::uuid[]) AND ${ROSTER}`,

  // The access check for a teacher: on the roster of a school she holds.
  teacher: `/* sc:teacher */
    SELECT u.id, u.phone_number, u.name, u.role, u.school_id, u.preferred_language, u.teacher_level, sch.name AS school_name, sch.emis
      FROM users u JOIN schools sch ON sch.id = u.school_id
     WHERE u.phone_number = $2 AND ${ROSTER} AND ${PATCH_HAS_SCHOOL}
     ORDER BY u.id LIMIT 1`,

  teacherById: `/* sc:teacher-by-id */
    SELECT u.id, u.phone_number, u.name, u.role, u.school_id, u.preferred_language, u.teacher_level, sch.name AS school_name, sch.emis
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

  // The step text of each report, and what titles it (its topic, its lesson label). The thing to try leaves the
  // database only for a C or D school ($2).
  actions: `/* sc:actions */
    SELECT c.id, c.prioritized_action ->> 'action' AS action,
           CASE WHEN $2::text IN ('C', 'D') THEN c.prioritized_action #>> '{thing_to_try,text}' END AS thing_text,
           c.analysis_data ->> 'topic' AS topic,
           c.prioritized_action ->> 'lesson_label' AS lesson_label, c.analysis_data ->> 'framework' AS framework,
           c.analysis_data #>> '{focus_area,try_this_tomorrow}' AS focus_try
      FROM coaching_sessions c
     WHERE c.id = ANY($1::uuid[])`,

  // One report, coach view. The observer is read too: a coach observation opens only when it happened, by a coach who
  // is not the teacher and not a test account (isCoachObservation), the same rule the counts use.
  session: `/* sc:session */
    SELECT c.id, c.user_id, c.created_at, c.status, c.observation_type, c.duplicate_of_session_id,
           c.analysis_data, c.prioritized_action, c.conversation_state,
           c.observer_user_id, ou.name AS observer_name, (ou.is_test_user IS TRUE) AS observer_test
      FROM coaching_sessions c LEFT JOIN users ou ON ou.id = c.observer_user_id
     WHERE c.id = $1::uuid`,

  // Every practice's score of these reports (analysis_data.domains, detoasted once each), whether a plan was linked,
  // and the plan steps the grader judged (analysis_data.lp_fidelity: Lesson Plan Fidelity, bd-dgfkgs.3).
  domains: `/* sc:domains */
    SELECT s.id, s.a -> 'domains' AS domains, s.a #> '{scores,has_lesson_plan}' AS has_plan, s.a -> 'lp_fidelity' AS lp_fidelity
      FROM (SELECT id, analysis_data #> '{}'::text[] AS a
              FROM coaching_sessions
             WHERE id = ANY($1::uuid[])
            OFFSET 0) s`,
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
function daysUsedOf(period, events) {
  const days = new Set();
  for (const e of events) if (P.inPeriod(period, e.day) && P.isSchoolDay(e.day)) days.add(e.day);
  return [...days].sort();
}
const daysWithUse = (period, events) => daysUsedOf(period, events).length;

/**
 * WHICH INSTRUMENTS MADE EACH USED DAY (bd-dgfkgs.4; operator 30 Oct: "8/21 isn't clear instrument by instrument").
 * The same days as daysUsedOf, each with the features she used that day (in CARD order: lp, dc, training, papers), and
 * how many of the days each feature was used on. A day with two features counts once in the total, once under each.
 * @param {{lp: Array, dc: Array, training: Array, papers: Array}} byFeature each feature's events ({ day })
 */
function usesOf(period, byFeature) {
  const order = ['lp', 'dc', 'training', 'papers'];
  const days = new Map();
  for (const f of order) {
    for (const e of byFeature[f] || []) {
      if (!P.inPeriod(period, e.day) || !P.isSchoolDay(e.day)) continue;
      if (!days.has(e.day)) days.set(e.day, new Set());
      days.get(e.day).add(f);
    }
  }
  const uses = [...days.keys()].sort().map((day) => ({ day, features: order.filter((f) => days.get(day).has(f)) }));
  const perFeature = Object.fromEntries(order.map((f) => [f, uses.filter((u) => u.features.includes(f)).length]));
  return { uses, perFeature };
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

/**
 * A REPORT'S TITLE (a row of the Coaching list), first that has words:
 *   1. analysis_data.topic, the lesson's topic as the analysis read it ("Types of Fractions"): on 8,919 of 9,041 DC
 *      reports in production over a month (checked 29 Oct);
 *   2. prioritized_action.lesson_label, the commitment card's 2–4 word subject · topic in her language, when the model
 *      wrote one. Its fallback paths write the framework's own name instead, upper-cased (commitment-card.service.js:
 *      `(analysis.framework || '').toUpperCase()`, so "FICO"), which is no title (5,784 of 9,041 are real);
 *   3. null: the page titles the row "<Subject> lesson".
 * A coach visit is titled the same way.
 * @param {string|null} topic analysis_data.topic
 * @param {string|null} label prioritized_action.lesson_label
 * @param {string|null} framework analysis_data.framework of the same report
 */
const PLACEHOLDER_LABELS = Object.freeze(['FICO']);
function reportTitleOf(topic, label, framework) {
  const fw = text(framework) ? text(framework).toUpperCase() : null;
  for (const candidate of [topic, label]) {
    const t = text(candidate);
    if (!t) continue;
    const up = t.toUpperCase();
    if (PLACEHOLDER_LABELS.includes(up) || up === fw) continue;
    return t;
  }
  return null;
}

/** The deployed framework's constants (ids, names, scale), read once; null when it cannot be loaded. */
let fwCache;
function frameworkConstants() {
  if (fwCache !== undefined) return fwCache;
  try {
    const c = require('../../bot/shared/services/coaching/frameworks/fico-framework').getScoringConstants();
    const names = new Map();
    for (const d of Object.values(c.domains || {})) for (const i of d.indicators || []) if (i && i.id) names.set(i.id, text(i.name));
    fwCache = { scaleMax: num(c.scaleMax), names };
  } catch (_) {
    fwCache = null;
  }
  return fwCache;
}

/** A plan step's verdict as the report page reads it (portal SessionReportPage verdictOf): done | partly | skipped | null. */
function verdictOf(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['executed', 'substituted_equivalent', 'substituted_better', 'done'].includes(v)) return 'done';
  if (['not_done', 'skipped'].includes(v)) return 'skipped';
  if (['partial', 'partly'].includes(v)) return 'partly';
  return null;
}

/** A report's measured plan: { pct, moves } when the grader judged its plan steps and gave the share followed, else null. */
function measuredPlanOf(lp) {
  const pct = lp && lp.status === 'ok' ? num(lp.fidelity_pct) : null;
  return pct == null ? null : { pct, moves: Array.isArray(lp.moves) ? lp.moves.filter(Boolean) : [] };
}

/**
 * LESSON PLAN FIDELITY (B), ACROSS HER REPORTS (bd-dgfkgs.3; operator 30 Oct: "moves for both, DC and HITL"). B is the
 * plan steps the grader judged (analysis_data.lp_fidelity), the same measure her report card and voice note give, never
 * the removed B1-B10 practices. `pct`: the mean share of plan steps followed over the reports that measured one;
 * `steps`: for each of the report card's five steps (report-card stepOf: 1 Opening … 5 Check) that any report judged, how
 * many of its plan steps were done, partly done or skipped. Null when no report measured its plan.
 */
function planAcross(rows) {
  const plans = rows.map((r) => measuredPlanOf(r && r.lp_fidelity)).filter(Boolean);
  if (!plans.length) return { scoredIn: 0, plan: null };
  const steps = new Map();
  for (const p of plans) {
    for (const m of p.moves) {
      const step = stepOf(m.phase);
      const v = verdictOf(m.verdict);
      if (!step || !v) continue;
      if (!steps.has(step.index)) steps.set(step.index, { step: step.index, done: 0, partly: 0, skipped: 0 });
      steps.get(step.index)[v] += 1;
    }
  }
  return {
    scoredIn: plans.length,
    plan: {
      pct: Math.round(plans.reduce((t, p) => t + p.pct, 0) / plans.length),
      steps: [...steps.values()].sort((a, b) => a.step - b.step),
    },
  };
}

/**
 * EVERY PRACTICE, AVERAGED ACROSS HER REPORTS. For each practice (indicator) a report scored, the mean of its score
 * as a share of that report's own scale (a section's domain_max over its practices, scaleMaxOf), given back on the
 * deployed framework's scale (FICO v3: 2) and as a %. A practice the report did not score (not applicable, no score) is
 * not averaged in. All four sections, B C D F, each with its average (the mean of its practices' averages; null = Not
 * scored) and `scoredIn` (how many reports scored it); the practices in framework order, the framework's names (one it
 * does not know keeps the report's name). Lesson Plan Fidelity (B) has no practices: it is the plan steps (planAcross,
 * its `plan`). Only reports whose score counts are passed in (a coach observation: reviewed, FICO form), so a /observe2
 * field-form visit is never mixed in.
 * @param {Array<{domains: object, has_plan: boolean|null, lp_fidelity: object|null}>} rows
 */
function practiceAveragesOf(rows) {
  const fw = frameworkConstants();
  const acc = new Map();
  const scoredIn = Object.fromEntries(SECTIONS.map((x) => [x.code, 0]));
  let reports = 0;
  for (const r of rows) {
    const domains = r && r.domains && typeof r.domains === 'object' ? r.domains : null;
    if (!domains) continue;
    reports += 1;
    for (const sec of indicatorsOf({ domains })) {
      const meta = SECTIONS.find((x) => x.key === sec.key);
      const d = domains[sec.key] || {};
      if (!meta || sec.key === 'lesson_plan_fidelity') continue;
      const max = scaleMaxOf(d);
      if (!max) continue;
      let counted = false;
      for (const i of sec.items) {
        if (!i.id || typeof i.score !== 'number' || !Number.isFinite(i.score)) continue;
        counted = true;
        if (!acc.has(i.id)) acc.set(i.id, { id: i.id, code: meta.code, name: (fw && fw.names.get(i.id)) || i.name, shares: [], max });
        const e = acc.get(i.id);
        e.shares.push(Math.max(0, Math.min(1, i.score / max)));
        e.max = max;
      }
      if (counted) scoredIn[meta.code] += 1;
    }
  }
  if (!reports) return [];
  const tenths = (x) => Math.round(x * 10) / 10;
  const b = planAcross(rows.filter((r) => r && r.domains && typeof r.domains === 'object'));
  return SECTIONS.map(({ code, name }) => {
    if (code === 'B') return { code, name, avg: null, scoredIn: b.scoredIn, indicators: [], plan: b.plan };
    const indicators = [...acc.values()].filter((e) => e.code === code)
      .sort((x, y) => practiceOrder(x.id) - practiceOrder(y.id) || x.id.localeCompare(y.id))
      .map((e) => {
        const share = e.shares.reduce((t, x) => t + x, 0) / e.shares.length;
        const scaleMax = (fw && fw.scaleMax) || e.max;
        return { id: e.id, name: e.name, avg: Math.round(share * scaleMax * 10) / 10, pct: Math.round(share * 100), scaleMax, n: e.shares.length };
      });
    // The section's own figure: the mean of its practices' averages; null (Not scored) when no report scored it.
    const avg = indicators.length ? tenths(indicators.reduce((t, i) => t + i.avg, 0) / indicators.length) : null;
    return { code, name, avg, scoredIn: scoredIn[code], indicators };
  });
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

/** A teaching level from the address (any case), or null: PRIMARY | MIDDLE | HIGH. */
function levelOf(raw) {
  const v = String(raw == null ? '' : raw).trim().toUpperCase();
  return VALID_LEVELS.includes(v) ? v : null;
}

/**
 * Her school(s) for this EMIS and their roster, or null when the EMIS is not one of hers. With a level, `teachers` is
 * the ones who teach at it; `levels` counts the whole roster at each level either way.
 */
async function schoolContext(query, coachId, emis, rawLevel) {
  if (!coachId || !emis) return null;
  const schools = rowsOf(await query(SQL.school, [coachId, String(emis)]));
  if (!schools.length) return null;
  const ids = [...new Set(schools.map((s) => s.id))];
  const roster = rowsOf(await query(SQL.roster, [ids]));
  const seen = new Set();
  const everyone = roster.filter((u) => !seen.has(u.id) && seen.add(u.id)).map((u) => ({
    id: u.id, teacherExtId: u.phone_number, name: displayNameOf(u), isPrincipal: u.role === 'principal',
    levels: teacherLevelOf(u),
  }));
  const level = levelOf(rawLevel);
  const levels = Object.fromEntries(VALID_LEVELS.map((l) => [l, everyone.filter((t) => t.levels.includes(l)).length]));
  return {
    school: { emis: String(emis), name: text(schools[0].school_name) || text(schools[0].name), ids },
    teachers: level ? everyone.filter((t) => t.levels.includes(level)) : everyone,
    roster: everyone.length,
    level,
    levels,
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

/** One kind's sessions, the score that counts for it, and whether one is in the period / the period before. */
function scoredKind(kind, act, period) {
  const prev = P.previousOf(period);
  const pctOf = (s) => (act.scored.get(s.id) || {}).pct;
  const list = kind === 'dc'
    ? act.sessions.filter((s) => isDcObservation(s, pctOf(s)))
    : act.sessions.filter(isCoachObservation);
  const scoreOf = kind === 'dc' ? (s) => pctOfSession(act, s) : (s) => ficoVisitScore(act, s);
  const inP = (s) => P.inPeriod(period, s.day);
  const inPrev = (s) => s.day >= prev.from && s.day <= prev.to;
  return { list, scoreOf, inP, inPrev };
}

/**
 * The school's Digital Coaching or Coach observations scores for the period: how many (a coach observation counts once
 * it happened, scored or not), the average score against the period before (coach: reviewed FICO-form visits only),
 * how many teachers had one, each scored report (oldest first) and the average per bucket (null where none).
 */
function schoolScoresOf(kind, act, period, teachers) {
  const { list, scoreOf, inP, inPrev } = scoredKind(kind, act, period);
  const extOf = new Map(teachers.map((t) => [t.id, t.teacherExtId]));
  const now = list.filter(inP);
  const points = now.filter((s) => scoreOf(s) != null).sort(byAt)
    .map((s) => ({ id: s.id, date: s.day, score: scoreOf(s), teacherExtId: extOf.get(s.user_id) || null }));
  return {
    count: now.length,
    avg: mean(now.map(scoreOf)),
    prevAvg: mean(list.filter(inPrev).map(scoreOf)),
    makers: new Set(now.map((s) => s.user_id)).size,
    points,
    series: period.buckets.map((_, i) => mean(points.filter((p) => P.bucketIndexOf(period, p.date) === i).map((p) => p.score))),
  };
}

/** GET /school/:emis/card */
async function getSchoolCard(query, coachId, emis, opts = {}) {
  const ctx = await schoolContext(query, coachId, emis, opts.level);
  if (!ctx) return null;
  const period = resolvePeriod(opts);
  const ids = ctx.teachers.map((t) => t.id);
  // Sessions from the period before too: the score tiles compare against it (the counts take only the period).
  const prev = P.previousOf(period);
  const act = await loadActivity(query, ids, period, { ...opts, sessionsRange: { from: prev.from, to: period.to } });
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
    school: {
      emis: ctx.school.emis, name: ctx.school.name, teachers: ctx.teachers.length, roster: ctx.roster,
      lastVisitDaysAgo: daysAgo(schoolLast, period.today),
    },
    period: P.publicPeriod(period),
    level: ctx.level,
    levels: ctx.levels,
    tiles,
    teachers: rows.map((r, i) => ({
      teacherExtId: r.t.teacherExtId,
      name: r.t.name,
      isPrincipal: r.t.isPrincipal,
      levels: r.t.levels,
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
    scores: Object.fromEntries(SCORE_KINDS.map((k) => [k, schoolScoresOf(k, act, period, ctx.teachers)])),
  };
}

/**
 * GET /school/:emis/scores/:kind — one kind's scores by teacher: count, average, each report's score, sorted by count,
 * then average, then name (teachers with none last); and the school's (its name, roster size, count, average, makers).
 */
async function getSchoolScores(query, coachId, emis, kind, opts = {}) {
  if (!SCORE_KINDS.includes(kind)) return null;
  const ctx = await schoolContext(query, coachId, emis, opts.level);
  if (!ctx) return null;
  const period = resolvePeriod(opts);
  const act = await loadActivity(query, ctx.teachers.map((t) => t.id), period, opts);
  const { list, scoreOf, inP } = scoredKind(kind, act, period);
  const now = list.filter(inP);
  const rows = ctx.teachers.map((t) => {
    const hers = now.filter((s) => s.user_id === t.id);
    return {
      teacherExtId: t.teacherExtId,
      name: t.name,
      count: hers.length,
      avg: mean(hers.map(scoreOf)),
      points: hers.filter((s) => scoreOf(s) != null).sort(byAt).map((s) => ({ id: s.id, date: s.day, score: scoreOf(s) })),
    };
  }).sort((a, b) => (b.count - a.count) || ((b.avg ?? -1) - (a.avg ?? -1)) || byName(a, b));
  return {
    kind,
    period: P.publicPeriod(period),
    rows,
    school: {
      emis: ctx.school.emis, name: ctx.school.name, teachers: ctx.teachers.length,
      count: now.length, avg: mean(now.map(scoreOf)), makers: new Set(now.map((s) => s.user_id)).size,
    },
  };
}

/** GET /school/:emis/feature/:feature */
async function getSchoolFeature(query, coachId, emis, feature, opts = {}) {
  if (!FEATURES.includes(feature)) return null;
  const ctx = await schoolContext(query, coachId, emis, opts.level);
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

/**
 * The Coaching summary (the Teacher page's Coaching card and the Coaching page's top): her DC observations and her
 * coach visits in the period, each with its average score against the period before (AI score: every DC report; Coach
 * score: the reviewed FICO-form visits only).
 */
function coachingSummaryOf(act, dc, visits, inP, inPrev) {
  const ai = (list) => mean(list.map((s) => pctOfSession(act, s)));
  const coach = (list) => mean(list.map((s) => ficoVisitScore(act, s)));
  return {
    dc: { count: dc.filter(inP).length, avg: ai(dc.filter(inP)), prevAvg: ai(dc.filter(inPrev)) },
    coach: { count: visits.filter(inP).length, avg: coach(visits.filter(inP)), prevAvg: coach(visits.filter(inPrev)) },
  };
}

/** The two-series chart: the AI score of each DC report and the Coach score of each reviewed FICO-form visit, by time. */
function coachingChartOf(act, dc, visits, inP) {
  return [
    ...dc.filter(inP).map((s) => ({ kind: 'dc', id: s.id, at: s.at, date: s.day, score: pctOfSession(act, s) })),
    ...visits.filter(inP).map((s) => ({ kind: 'coach', id: s.id, at: s.at, date: s.day, score: ficoVisitScore(act, s) })),
  ].filter((p) => p.score != null).sort(byAt).map(({ at, ...p }) => p);
}

const teacherOut = (teacher) => ({
  teacherExtId: teacher.phone_number, name: teacher.displayName, school: text(teacher.school_name), emis: teacher.emis == null ? null : String(teacher.emis),
  // bd-ewbzns.2 — her role and teaching levels, so what Edit teacher changed shows on her page.
  isPrincipal: teacher.role === 'principal', levels: teacherLevelOf(teacher),
});

/** GET /teacher/:ext/card */
async function getTeacherCard(query, coachId, ext, opts = {}) {
  const teacher = await teacherOf(query, coachId, ext);
  if (!teacher) return null;
  const { period, act, events, dc, visits, inP, inPrev } = await teacherActivity(query, teacher, opts);
  const ids = [teacher.id];
  const series = (list) => tally(period, list, ids).get(teacher.id);
  const tile = (list) => { const t = series(list); return { count: t.total, series: t.cells }; };
  const courses = await coursesOf(query, teacher.id, [...new Set(events.training.filter((p) => P.inPeriod(period, p.day)).map((p) => p.moduleId))]);
  const trn = series(events.training);

  return {
    teacher: teacherOut(teacher),
    period: P.publicPeriod(period),
    tiles: {
      lp: tile(events.lp),
      papers: tile(events.papers),
      training: { parts: trn.total, courses: courses.filter((c) => c.done && P.inPeriod(period, c.lastDone)).length, series: trn.cells },
      days: (() => {
        // the dates too: the page draws one dot per school day, filled on a day she used NIETE; and what she used each day
        const used = daysUsedOf(period, [...events.lp, ...dc, ...events.training, ...events.papers]);
        return { withUse: used.length, schoolDays: period.schoolDaysSoFar, used, ...usesOf(period, { lp: events.lp, dc, training: events.training, papers: events.papers }) };
      })(),
    },
    // Her DC observations and coach visits are ONE Coaching card: this summary and this chart.
    summary: coachingSummaryOf(act, dc, visits, inP, inPrev),
    chart: coachingChartOf(act, dc, visits, inP),
  };
}

const newestFirst = (a, b) => atMs(b.at) - atMs(a.at);
const formOf = (act, s) => (isFieldForm((act.scored.get(s.id) || {}).info) ? 'observe2' : 'v3');

/** GET /teacher/:ext/items/:feature (lp | papers | training) */
async function getTeacherItems(query, coachId, ext, feature, opts = {}) {
  if (!ITEM_FEATURES.includes(feature)) return null;
  const teacher = await teacherOf(query, coachId, ext);
  if (!teacher) return null;
  const { period, events } = await teacherActivity(query, teacher, opts);
  const base = { feature, period: P.publicPeriod(period) };
  const inPeriodOnly = (list) => list.filter((e) => P.inPeriod(period, e.day)).sort(newestFirst);
  switch (feature) {
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

/** The language her report was written in: the narrative's own, else her preference. */
function languageOf(narrative, teacher) {
  const l = (narrative && narrative._language) || (teacher && teacher.preferred_language);
  return l === 'ur' ? 'ur' : 'en';
}

/**
 * GET /teacher/:ext/scores/:kind — her DC reports (kind dc) or her coach observations (kind coach) on their own: how many,
 * the average score against the period before, each scored report's score (oldest first), every practice averaged
 * across her scored reports (practiceAveragesOf), and the reports, newest first, each with its class and title (topic,
 * else a real lesson label, else null). A coach observation counts and lists once it happened; only a reviewed visit on
 * the FICO form has a score, so a /observe2 field-form visit is listed (form 'observe2') and never averaged.
 */
async function getTeacherScores(query, coachId, ext, kind, opts = {}) {
  if (!SCORE_KINDS.includes(kind)) return null;
  const teacher = await teacherOf(query, coachId, ext);
  if (!teacher) return null;
  const { period, act } = await teacherActivity(query, teacher, opts);
  const { list, scoreOf, inP, inPrev } = scoredKind(kind, act, period);
  const now = list.filter(inP).sort(byAt);
  const scored = now.filter((s) => scoreOf(s) != null);
  const ids = now.map((s) => s.id);
  // The title fields only (no step: the thing to try is never read here, $2 null).
  const actions = new Map(ids.length ? rowsOf(await query(SQL.actions, [ids, null])).map((r) => [r.id, r]) : []);
  const domains = scored.length ? rowsOf(await query(SQL.domains, [scored.map((s) => s.id)])) : [];
  const info = (s) => (act.scored.get(s.id) || {}).info || {};
  return {
    teacher: teacherOut(teacher),
    period: P.publicPeriod(period),
    kind,
    count: now.length,
    avg: mean(now.map(scoreOf)),
    prevAvg: mean(list.filter(inPrev).map(scoreOf)),
    series: scored.map((s) => ({ id: s.id, date: s.day, score: scoreOf(s) })),
    sections: practiceAveragesOf(domains),
    reports: [...now].sort(newestFirst).map((s) => {
      const a = actions.get(s.id) || {};
      return {
        id: s.id,
        date: s.day,
        grade: info(s).grade || null,
        subject: info(s).subject || null,
        title: reportTitleOf(a.topic, a.lesson_label, a.framework),
        score: scoreOf(s),
        form: kind === 'coach' ? formOf(act, s) : null,
        coachName: kind === 'coach' ? text(s.observer_name) : null,
      };
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

function practiceOrder(id) {
  const m = /(\d+)\s*$/.exec(String(id || ''));
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * GET /session/:id — one report of a teacher in her patch, coach view: a DC report (the v10 rule for its next step; a
 * re-send opens the report it repeats) or a coach observation (any coach; one that happened, not by the teacher, not by
 * a test account, as the counts). A coach observation's scores show only once it is reviewed; its step is the step
 * agreed; `form` says whether it was on the /observe2 field form.
 */
async function getSession(query, coachId, sessionId, opts = {}) {
  let row = rowsOf(await query(SQL.session, [sessionId]))[0];
  if (!row || !row.user_id) return null;
  const visit = row.observation_type === HUMAN_OBSERVATION;
  if (row.observation_type != null && !visit) return null;
  if (visit && !isCoachObservation(row)) return null;
  const teacher = rowsOf(await query(SQL.teacherById, [coachId, row.user_id]))[0];
  if (!teacher) return null;
  // A re-send reused an earlier report: open that one (hers too, and a DC session).
  if (!visit && row.duplicate_of_session_id) {
    const orig = rowsOf(await query(SQL.session, [row.duplicate_of_session_id]))[0];
    if (orig && orig.user_id === row.user_id && orig.observation_type == null) row = orig;
  }
  const group = visit ? null : await groupOf(query, teacher.school_id);
  const a = row.analysis_data && typeof row.analysis_data === 'object' ? row.analysis_data : {};
  const domains = a.domains && typeof a.domains === 'object' ? a.domains : {};
  const narrative = a.report_narrative || null;
  const moves = movesOf(a);
  const questions = (row.conversation_state && Array.isArray(row.conversation_state.questions)) ? row.conversation_state.questions : [];
  const reviewed = visit ? REVIEWED.includes(row.status) : true;
  const pa = row.prioritized_action && typeof row.prioritized_action === 'object' ? row.prioritized_action : {};

  return {
    sessionId: row.id,
    kind: visit ? 'coach' : 'dc',
    coachName: visit ? text(row.observer_name) : null,
    form: visit ? (isFieldForm({ rubric: a.observe2 && a.observe2.rubric }) ? 'observe2' : 'v3') : null,
    reviewed,
    teacher: { teacherExtId: teacher.phone_number, name: displayNameOf(teacher) },
    date: P.pkDayOf(row.created_at),
    grade: a.grade == null || a.grade === '' ? null : String(a.grade),
    subject: text(a.subject),
    overall: reviewed ? round(overallOf(a.scores)) : null,
    whatWentWell: wells(a, languageOf(narrative, teacher), narrative),
    nextStep: visit
      ? text(pa.action) || text(a.focus_area && a.focus_area.try_this_tomorrow)
      : nextStepShown(row.prioritized_action, group),
    // B is the share of plan steps followed (bd-dgfkgs.3), never the old B section's own score.
    sections: SECTIONS.filter((s) => domains[s.key]).map((s) => ({
      code: s.code, name: s.name,
      pct: !reviewed ? null
        : s.key === 'lesson_plan_fidelity' ? round((measuredPlanOf(a.lp_fidelity) || {}).pct)
          : sectionPctOf(domains[s.key].domain_score, domains[s.key].domain_max, domains[s.key].assessed),
    })),
    // Every practice but B's: Lesson Plan Fidelity is the plan steps (lpSteps), not the removed B1-B10.
    practices: indicatorsOf(a).filter((sec) => sec.key !== 'lesson_plan_fidelity').flatMap((sec) => {
      const code = (SECTIONS.find((s) => s.key === sec.key) || {}).code || null;
      const scaleMax = scaleMaxOf(domains[sec.key]);
      return sec.items.filter((i) => i.id)
        .sort((x, y) => practiceOrder(x.id) - practiceOrder(y.id))
        .map((i) => ({ id: i.id, name: i.name, section: code, score: reviewed ? i.score : null, scaleMax }));
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
  SCORE_KINDS,
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
  reportTitleOf,
  levelOf,
  getSchoolCard,
  getSchoolFeature,
  getTeacherCard,
  getTeacherItems,
  getTeacherScores,
  getSchoolScores,
  practiceAveragesOf,
  getSession,
};
