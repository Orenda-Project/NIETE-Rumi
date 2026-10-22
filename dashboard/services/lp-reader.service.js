'use strict';
/**
 * bd-4joiqz — WHO is opening a lesson plan, and what that open does.
 *
 * "why can't a coach see LPs in their IAB? Shouldnt we make them available?" (operator, 22 Oct 2026). The leader
 * family (coach, principal, AEO, supervisor, school leader) now READS the plans teachers get: grades 1-5, grades
 * 6-12 and Reading Hour & Numeracy, on the same pages. A leader's open is not a teacher's.
 *
 * WHAT A LEADER'S OPEN DOES NOT RECORD
 *   niete_lp_opens          its readers all take a row as "a teacher used this plan": her Recent, the Home's counts, the
 *                           15:00 quiz offer, the coaching ask, the ready-WhatsApp sweep, lp-context, the FLN "opened" tick
 *   the survey              "was this plan useful?" is a teacher's question (lp-open-survey.client)
 *   lesson_plan_requests    the routes ask the bot AS A READER (`reader: 'leader'`, with the leader's own id): the bot's
 *                           k5 PDF lookup and 6-12 ask then write no lifecycle row (lp/v8/pdf, lp612/request)
 *   lp.v10.plan_served      the k5 lookup serves the plan of the leader's SCHOOL (the ch3-8 A/B group, the v10 card), exactly
 *                           as for a teacher there, but never logs it as a plan served to a drawn teacher
 *
 * WHAT IT DOES RECORD
 *   lp.leader_open          ONE telemetry event per open, ids only (user uuid, role, plan kind, ref, source), on the
 *                           portal's own sink (telemetry.service; the bot's structured logger needs pino, not installed here)
 *   the 6-12 claim          the leader's own niete_lp612_deliveries row (written by the bot when they ask): /lp612/status
 *                           and /lp612/file answer only to a user with a claim. Their 6-12 open marks it opened
 *                           (notice_opened_at, the column the teacher app writes when she opens a plan from its banner), so
 *                           the ready-WhatsApp sweep, which reads an open from niete_lp_opens OR that column, never chases it.
 *
 * THE ROLE IS THE SERVER'S. Read from `users` on every open, never from the client. The request carries no role
 * (requirePortalAuth loads no user; the session holds the user id only), so this is one indexed read by primary key,
 * BOUNDED: the whole decision is raced against READ_TIMEOUT_MS, and a decision that does not come in time is a
 * teacher's, so a slow or hung read can never hold a teacher's plan. A principal ON the teacher app (portal_teacher_v2)
 * is a teacher here: she gets the teacher app exactly as a teacher does (operator, 2026-10-09). Anything unreadable —
 * the role, or a principal's teacher-app switch — is a teacher too: today's path is the safe one for the opens that are
 * nearly all teachers', and a leader's stray row is recoverable where a teacher's lost open is not.
 */

const supabase = require('../config/supabase');
const { isLeaderRole } = require('../lib/leader-role');
const { isFlagEnabledForUser, PORTAL_TEACHER_V2_KEY } = require('../lib/feature-flags');
const LpActivity = require('./lp-activity.service');
const telemetry = require('./telemetry.service');

// Required where they are used, not here: the FLN routes load this module and never ask for a survey or mark a
// 6-12 request, so loading them never pulls the bot HTTP client (axios) or the notices' bot vocabulary along
// (tests/portal/fln-ab-isolation.test.js loads the FLN routes in a bare Node).
const surveyClient = () => require('./lp-open-survey.client');
const notices = () => require('./teacher-notices.service');

const EVENT = 'lp.leader_open';

/** The longest a reader decision may take before the open goes ahead as a teacher's. */
const READ_TIMEOUT_MS = 2000;

/** A teacher: today's open path. */
const TEACHER = Object.freeze({ leader: false, role: null });

const normalize = (role) => (typeof role === 'string' && role.trim() ? role.trim().toLowerCase() : null);

async function readRole(userId) {
  const { data, error } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message || 'users read failed');
  return normalize(data && data.role);
}

async function decide(userId, known) {
  try {
    const role = Object.prototype.hasOwnProperty.call(known, 'role') ? normalize(known.role) : await readRole(userId);
    if (!isLeaderRole(role)) return { leader: false, role };
    // `strict`: a switch that cannot be read throws (→ a teacher below), never reads as "not on the teacher app".
    if (role === 'principal' && await isFlagEnabledForUser(supabase, PORTAL_TEACHER_V2_KEY, userId, { strict: true })) {
      return { leader: false, role };
    }
    return { leader: true, role };
  } catch (error) {
    console.warn('⚠️ Lesson plan open: the role could not be read — recorded as a teacher open', { error: error && error.message });
    return TEACHER;
  }
}

/**
 * Who is opening: { leader, role }. Never throws, and answers within `timeoutMs` (a teacher, when the reads have not).
 *
 * @param {string|null} userId the SESSION user
 * @param {{ role?: string|null }} [known] the role when the caller has just read it (FLN's access check re-reads
 *   users.role on every request): no second read. A known `null` is a teacher.
 * @param {{ timeoutMs?: number }} [opts]
 */
async function readerOf(userId, known = {}, { timeoutMs = READ_TIMEOUT_MS } = {}) {
  if (!userId) return TEACHER;
  let timer = null;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn('⚠️ Lesson plan open: the role read did not answer in time — recorded as a teacher open', { timeoutMs });
      resolve(TEACHER);
    }, timeoutMs);
  });
  try {
    return await Promise.race([decide(userId, known), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The open itself, for either reader. Fire-and-forget like LpActivity.logOpen: never throws, never awaited by a route.
 *
 * @param {{leader: boolean, role: string|null}} reader  readerOf's answer
 * @param {(sql: string, params: any[]) => Promise<{rows: any[]}>} query
 * @param {{userId: string, kind: 'k5'|'g612'|'fln', ref: string, lang?: string|null, source: 'viewer'|'external'}} open
 * @param {{ survey?: boolean, renderId?: string|null, activity?: object }} [opts]
 *   survey    a teacher's open asks for the "was this useful?" survey (k5, g612; never FLN)
 *   renderId  a grades 6-12 open: the request a leader's open marks opened
 *   activity  the open writer (FLN's router injects its own)
 */
function recordOpen(reader, query, open, { survey = true, renderId = null, activity = LpActivity } = {}) {
  if (!reader || !reader.leader) {
    const pending = activity.logOpen(query, open);
    return survey ? pending.then((result) => surveyClient().afterOpen(result)) : pending;
  }
  try {
    telemetry.logEvent(EVENT, {
      userId: open.userId, role: reader.role, kind: open.kind, ref: open.ref, source: open.source,
    });
  } catch (_) { /* a log line never costs the plan */ }
  if (!renderId) return Promise.resolve({ recorded: false, leader: true });
  return Promise.resolve()
    .then(() => notices().markOpened(query, open.userId, `lesson:${renderId}`))
    .catch((error) => {
      console.error('❌ Lesson plan open: a leader\'s request not marked opened', { error: error && error.message });
    })
    .then(() => ({ recorded: false, leader: true }));
}

module.exports = { EVENT, READ_TIMEOUT_MS, readerOf, recordOpen };
