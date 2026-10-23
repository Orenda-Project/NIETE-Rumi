'use strict';
/**
 * Teacher Home card — the teacher Home's per-teacher tile order and its ONE card, as pure functions plus the reads behind them.
 * Used by routes/portal-teacher-home.routes.js (GET /api/portal/me/home). Nothing here writes; no new table or column.
 *
 * THE ORDER (rankFeatures, behind portal_teacher_home_order). Ranked from what the teacher DID, in the database, never from
 * page views (those live in Axiom only, app-funnel.routes.js). The unit is DISTINCT DAYS with a row in the last 28,
 * not rows: ten plans in one sitting are one day of use, not ten.
 *   score   = Σ over the feature's active days of 0.5^(age_days / 14)   (a 14-day half-life; recent use wins a tie)
 *   lead    = a feature needs ≥ 2 active days to move above `lessons` (one stray use must not reorder the Home)
 *   new     = fewer than 2 active days in 28 across every feature → the fixed order (a brand-new teacher sees today's)
 *   ties    = and zeros fall back to the fixed order
 *   classes and analytics have no "did" row: they keep their fixed slots after every ranked feature.
 *
 * TILE KEYS — the portal's own (portal/src/portal/teacher/pages/Home.tsx TILES, in that file's fixed order):
 *   lessons · coaching · observations · training · assessment · attendance · classes · analytics
 * Each ranked key reads one table, by the teacher's users.id:
 *   lessons       lesson_plans.user_id, created_at
 *   coaching      coaching_sessions own: user_id, observation_type IS NULL, status 'completed', created_at
 *   observations  coaching_sessions RECEIVED: user_id, observation_type 'leader_observation', sent to the teacher
 *                 (analysis_data.teacher_delivery.status in lib/teacher-observation.js SENT_TO_TEACHER), created_at
 *   assessment    assessment_requests.user_id, created_at
 *   attendance    attendance_sessions.user_id — the teacher who marked the class: the single write path
 *                 (bot/shared/services/attendance-write.service.js, reached from portal-teacher-attendance.routes.js
 *                 through services/teacher-attendance.service.js) inserts user_id = the marking teacher. created_at
 *                 (the day it was saved), not session_date (the class day, which can be back-filled).
 *                 NOT teacher_attendance_records: that is a leader marking the TEACHER present, not the teacher's own use.
 *   training      teacher_training_progress.user_id, completed_at (the table is insert-only and has no created_at:
 *                 a row IS a completion)
 *
 * THE CARD (pickCard, behind portal_teacher_home_card) — the design rule R5 ladder, first match wins:
 *   1 class         the bot's primary {kind:'class'} (newest send of 72 h with < 5 played)     → quizHome
 *   2 coach_report  the teacher's own completed coaching session of the last 7 days                       → the report
 *   3 lesson        the bot's primary {kind:'lesson'} (un-quizzed LP / session of 7 days)       → quizHome
 *                   or, when the bot ANSWERED (a quizHome path) but had no lesson, the teacher's newest un-quizzed
 *                   lesson_plans row of 7 days (see LESSON_FALLBACK below)
 *   4 observation   an observation sent to the teacher in the last 14 days                              → observations
 *   5 first_plan    zero lesson_plans ever                                                       → lessons
 *   none            null: the page is today's Home
 * "NOT YET OPENED" for rungs 2 and 4 cannot be read here: opens are app_funnel events in Axiom only, and a request
 * never reads Axiom. So tonight the WINDOW IS THE RULE: a report shows for 7 days, an observation for 14. A follow-up
 * can read opens from a nightly job.
 * Rungs 1 and 3 go to the signed quiz home, so with no quizHome (the bot off, down, or the role a coach) they cannot
 * fire. A coach or principal (the bot's COACH_ROLES, copied below) never gets rungs 1 and 3.
 *
 * SCORES — the report page's rule (portal teacher/coaching/report.ts toReportData): marks/max, NEVER a stand-in zero.
 * The raw marks are analysis_data.scores.overall_marks, else scores.grand_total (the two keys getOverall reads,
 * coaching-frameworks.service.js); getOverall's own read turns a missing value into 0, so the presence check is made
 * on the raw value first and getOverall only normalises a row that has one. Same path for an observation (a coach's
 * observation is a FICO-scored coaching_sessions row; the observations page bands its percentage from getOverall).
 */
const { getOverall } = require('./coaching-frameworks.service');
const TeacherObservation = require('../lib/teacher-observation');

/** Home.tsx TILES, in order. Ties and zeros fall back to this. */
const FIXED_ORDER = Object.freeze(['lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance', 'classes', 'analytics']);
/** The tiles with a "did" row; classes and analytics keep their slots after these. */
const RANKED = Object.freeze(['lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance']);
const UNRANKED = Object.freeze(['classes', 'analytics']);

const DAY_MS = 86400000;
const WINDOW_DAYS = 28;
const HALF_LIFE_DAYS = 14;
const MIN_DAYS = 2;
const REPORT_WINDOW_MS = 7 * DAY_MS;
const OBSERVATION_WINDOW_MS = 14 * DAY_MS;
const LESSON_FALLBACK_MS = 7 * DAY_MS;

/** bot/shared/services/first-touch/teacher-home.routes.js COACH_ROLES — copied, the bot's file is not required here. */
const COACH_ROLES = new Set(['coach', 'principal', 'school_leader', 'supervisor', 'aeo', 'head']);
const isCoachRole = (role) => COACH_ROLES.has(String(role || '').trim().toLowerCase());

/**
 * A row's instant. lesson_plans.created_at is `timestamp WITHOUT time zone` (written by now() in UTC), so it arrives
 * with no offset; Date would read that as LOCAL time and move a late-evening plan to the wrong day. No offset → UTC.
 */
function toMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || !v) return NaN;
  const s = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) || !/T|\s\d/.test(v) ? v : `${v.replace(' ', 'T')}Z`;
  return new Date(s).getTime();
}

/** The UTC day number of an instant (whole days since the epoch). */
const dayNo = (ms) => Math.floor(ms / DAY_MS);

/** Distinct UTC days (as day numbers) inside the 28-day window ending today; future rows are dropped. */
function activeDays(values, now) {
  const today = dayNo(toMs(now));
  const out = new Set();
  (Array.isArray(values) ? values : []).forEach((v) => {
    const t = toMs(v);
    if (!Number.isFinite(t)) return;
    const age = today - dayNo(t);
    if (age >= 0 && age < WINDOW_DAYS) out.add(dayNo(t));
  });
  return out;
}

/**
 * The tile order for one teacher. Pure.
 * @param {Object<string, Array<string|Date>>} daysByFeature  { lessons, coaching, observations, assessment, attendance,
 *        training }: each a list of row dates (ISO strings or Dates; repeats on a day are fine)
 * @param {string|number|Date} now
 * @returns {string[]} the 8 tile keys
 */
function rankFeatures(daysByFeature = {}, now = new Date()) {
  const today = dayNo(toMs(now));
  const src = daysByFeature || {};
  const all = new Set();
  const stats = RANKED.map((key, i) => {
    const days = activeDays(src[key], now);
    days.forEach((d) => all.add(d));
    let score = 0;
    days.forEach((d) => { score += 0.5 ** ((today - d) / HALF_LIFE_DAYS); });
    return { key, i, days: days.size, score };
  });
  if (all.size < MIN_DAYS) return [...FIXED_ORDER];

  const byScore = (a, b) => (b.score - a.score) || (a.i - b.i);
  const lessons = stats[0];
  // Above lessons: only a feature with ≥ 2 active days AND a higher score (a tie stays with lessons, first in the
  // fixed order). Everything else follows lessons by score, zeros in the fixed order.
  const leads = stats.slice(1).filter((s) => s.days >= MIN_DAYS && s.score > lessons.score).sort(byScore);
  const rest = stats.slice(1).filter((s) => !leads.includes(s)).sort(byScore);
  return [...leads.map((s) => s.key), 'lessons', ...rest.map((s) => s.key), ...UNRANKED];
}

/**
 * A coaching_sessions row's score, the report page's way: { marks, max, at, id } when the raw marks are a number,
 * else null (no chip, no number). Never a stand-in zero. Both chips (coach, observation) share this shape.
 */
function scoreOf(row) {
  if (!row || !row.id) return null;
  const s = (row.analysis_data && row.analysis_data.scores) || (row.scores && typeof row.scores === 'object' ? row.scores : null);
  if (!s) return null;
  const raw = s.overall_marks != null ? s.overall_marks : s.grand_total;
  if (raw == null || raw === '' || !Number.isFinite(Number(raw))) return null;
  const o = getOverall({ scores: s });
  const at = Number.isFinite(toMs(row.created_at)) ? new Date(toMs(row.created_at)).toISOString() : null;
  return { marks: o.points, max: o.maxPoints > 0 ? o.maxPoints : null, at, id: String(row.id) };
}

const isoOf = (v) => (Number.isFinite(toMs(v)) ? new Date(toMs(v)).toISOString() : undefined);

/**
 * The card, the design rule R5 ladder. Pure.
 * @param {object} p
 * @param {object|null} p.bot          the bot's answer { path, primary, facts } or null (off / down / non-200)
 * @param {object|null} p.coach        the teacher's newest own completed coaching_sessions row { id, created_at, analysis_data }
 * @param {object|null} p.observation  the newest observation sent to the teacher { id, created_at, analysis_data }
 * @param {object|null} [p.lastPlan]   the teacher's newest un-quizzed lesson_plans row of 7 days { id, topic, created_at }
 * @param {number|null} p.lpCount      lesson_plans ever (null when the read failed: rung 5 cannot fire on a failure)
 * @param {string|null} [p.quizHome]   the signed quiz home path (defaults to bot.path)
 * @param {boolean} [p.isCoach]        a coach / principal: never rungs 1 and 3
 * @param {string|number|Date} p.now
 * @returns {null|{kind, title, played?, from?, score?, max?, at?, href, id?}}  score = the marks, max beside it (both
 *          null when the row has no usable marks)
 */
function pickCard({ bot = null, coach = null, observation = null, lastPlan = null, lpCount = null, quizHome, isCoach = false, now = new Date() } = {}) {
  const t = toMs(now);
  const home = quizHome !== undefined ? quizHome : (bot && typeof bot.path === 'string' ? bot.path : null);
  const quizOk = !isCoach && typeof home === 'string' && home.length > 0;
  const primary = bot && bot.primary && typeof bot.primary === 'object' ? bot.primary : null;
  const recent = (row, windowMs) => {
    const at = row ? toMs(row.created_at) : NaN;
    return Number.isFinite(at) && at <= t + 60000 && t - at <= windowMs;
  };

  // 1 — class: a send of 72 h few children finished (the bot's classCard).
  if (quizOk && primary && primary.kind === 'class') {
    return { kind: 'class', title: String(primary.title || ''), played: Number(primary.played) || 0, href: home };
  }
  // 2 — coach report: the teacher's own completed session of 7 days ("not yet opened" = the window, see the header).
  if (coach && coach.id && recent(coach, REPORT_WINDOW_MS)) {
    const s = scoreOf(coach);
    return {
      kind: 'coach_report', title: (coach.analysis_data && (coach.analysis_data.topic || coach.analysis_data.subject)) || '',
      score: s ? s.marks : null, max: s ? s.max : null, at: isoOf(coach.created_at), href: `/portal/teacher/coaching/${coach.id}`, id: String(coach.id),
    };
  }
  // 3 — lesson: the bot's un-quizzed LP / session of 7 days.
  if (quizOk && primary && primary.kind === 'lesson') {
    return {
      kind: 'lesson', title: String(primary.title || ''), from: primary.from === 'coach' ? 'coach' : 'lp', href: home,
      ...(primary.id ? { id: String(primary.id) } : {}),
    };
  }
  // 3 (fallback) — LESSON_FALLBACK: the bot's lesson list merges plans read in the app, but not in every case. So when
  // the bot ANSWERED (it gave a quizHome path) and had no job at all (primary none), the teacher's own newest un-quizzed
  // lesson_plans row of 7 days fires the rung (the build contract). Gated on the bot's path: with no quiz home there is nowhere
  // for "Quiz this" to go, and a bot that chose a story/video/make job has already judged there is no lesson to quiz.
  if (quizOk && bot && (!primary || primary.kind === 'none') && lastPlan && lastPlan.id && recent(lastPlan, LESSON_FALLBACK_MS)) {
    return { kind: 'lesson', title: String(lastPlan.topic || ''), from: 'lp', href: home, id: String(lastPlan.id) };
  }
  // 4 — observation: sent to the teacher in the last 14 days.
  if (observation && observation.id && recent(observation, OBSERVATION_WINDOW_MS)) {
    const s = scoreOf(observation);
    return {
      kind: 'observation', title: isoOf(observation.created_at) ? isoOf(observation.created_at).slice(0, 10) : '',
      score: s ? s.marks : null, max: s ? s.max : null, at: isoOf(observation.created_at), href: '/portal/teacher/observations', id: String(observation.id),
    };
  }
  // 5 — first plan: none ever (a failed count is not zero).
  if (lpCount === 0) return { kind: 'first_plan', title: '', href: '/portal/teacher/lessons' };
  return null;
}

/** One read's dates, or [] on any failure (a failed read = that feature has no days). */
async function datesOf(promise, column) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || 'read failed');
  return (data || []).map((r) => r && r[column]).filter(Boolean);
}

/**
 * The six reads behind rankFeatures, in parallel; each selects only its date column over the 28-day window and the
 * days are reduced in code. A read that fails leaves that feature with no days (Promise.allSettled), never an error.
 * @returns {Promise<Object<string, string[]>>}
 */
async function countsFor(supabase, userId, now = new Date()) {
  const since = new Date(toMs(now) - WINDOW_DAYS * DAY_MS).toISOString();
  const reads = {
    lessons: () => datesOf(supabase.from('lesson_plans').select('created_at').eq('user_id', userId).gte('created_at', since.replace('Z', '')), 'created_at'),
    coaching: () => datesOf(supabase.from('coaching_sessions').select('created_at').eq('user_id', userId)
      .is('observation_type', null).eq('status', 'completed').gte('created_at', since), 'created_at'),
    observations: () => datesOf(supabase.from('coaching_sessions').select('created_at').eq('user_id', userId)
      .eq('observation_type', TeacherObservation.OBSERVATION_TYPE)
      .in('analysis_data->teacher_delivery->>status', TeacherObservation.SENT_TO_TEACHER).gte('created_at', since), 'created_at'),
    assessment: () => datesOf(supabase.from('assessment_requests').select('created_at').eq('user_id', userId).gte('created_at', since), 'created_at'),
    attendance: () => datesOf(supabase.from('attendance_sessions').select('created_at').eq('user_id', userId).gte('created_at', since), 'created_at'),
    training: () => datesOf(supabase.from('teacher_training_progress').select('completed_at').eq('user_id', userId).gte('completed_at', since), 'completed_at'),
  };
  const keys = Object.keys(reads);
  const settled = await Promise.allSettled(keys.map((k) => Promise.resolve().then(reads[k])));
  return Object.fromEntries(keys.map((k, i) => [k, settled[i].status === 'fulfilled' ? settled[i].value : []]));
}

module.exports = {
  FIXED_ORDER,
  RANKED,
  COACH_ROLES,
  REPORT_WINDOW_MS,
  OBSERVATION_WINDOW_MS,
  LESSON_FALLBACK_MS,
  isCoachRole,
  activeDays,
  rankFeatures,
  scoreOf,
  pickCard,
  countsFor,
};
