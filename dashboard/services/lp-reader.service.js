'use strict';
/**
 * bd-4joiqz — WHO is opening a lesson plan, and what that open does.
 *
 * "why can't a coach see LPs in their IAB? Shouldnt we make them available?" (operator, 22 Oct 2026). The leader
 * family (coach, principal, AEO, supervisor, school leader) now READS the plans teachers get: grades 1-5, grades
 * 6-12 and Reading Hour & Numeracy, on the same pages. A leader's open is not a teacher's, so it:
 *
 *   writes no niete_lp_opens row   its readers all take a row as "a teacher used this plan": her Recent, the Home's
 *                                  counts, the 15:00 quiz offer, the coaching ask, the ready-WhatsApp sweep,
 *                                  lp-context, the FLN list's "opened" tick
 *   asks for no survey             "was this plan useful?" is a teacher's question (lp-open-survey.client)
 *   names nobody to the K-5 PDF    the bot's lp/v8/pdf records a lifecycle row for the user it is given and serves
 *   lookup                         that user's school A/B group (its `userId`); a leader gets today's plan, and no row
 *
 * and is ONE telemetry event instead, `lp.leader_open`, ids only (user uuid, role, plan kind, ref, source), so the
 * reading stays visible without a table or a column. The portal's own sink (telemetry.service): the bot's
 * structured logger needs pino, which this service does not install.
 *
 * A leader's grades 6-12 open also marks THEIR OWN request opened (niete_lp612_deliveries.notice_opened_at, the
 * column the teacher app writes when she opens a plan from its banner): the ready-WhatsApp sweep reads an open from
 * niete_lp_opens OR that column, so without a row it would chase a plan the leader already opened.
 *
 * THE ROLE IS THE SERVER'S. Read from `users` on every open, never from the session or the request. A principal ON
 * the teacher app (portal_teacher_v2, isFlagEnabledForUser) is a teacher here: she gets the teacher app exactly as a
 * teacher does (operator, 2026-10-09), and her opens stay today's. A role that cannot be read is a teacher too:
 * today's path is the safe one for the opens that are nearly all teachers', and a leader's stray row is recoverable
 * where a teacher's lost open is not.
 */

const supabase = require('../config/supabase');
const { isLeaderRole } = require('../lib/leader-role');
const { isFlagEnabledForUser, PORTAL_TEACHER_V2_KEY } = require('../lib/feature-flags');
const LpActivity = require('./lp-activity.service');
const LpOpenSurvey = require('./lp-open-survey.client');
const Notices = require('./teacher-notices.service');
const telemetry = require('./telemetry.service');

const EVENT = 'lp.leader_open';

/** A teacher: today's open path. */
const TEACHER = Object.freeze({ leader: false, role: null });

const normalize = (role) => (typeof role === 'string' && role.trim() ? role.trim().toLowerCase() : null);

async function readRole(userId) {
  const { data, error } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message || 'users read failed');
  return normalize(data && data.role);
}

/**
 * Who is opening: { leader, role }. Never throws.
 *
 * @param {string|null} userId the SESSION user
 * @param {{ role?: string|null }} [known] the role when the caller has just read it (FLN's access check re-reads
 *   users.role on every request): no second read. A known `null` is a teacher.
 */
async function readerOf(userId, known = {}) {
  if (!userId) return TEACHER;
  try {
    const role = Object.prototype.hasOwnProperty.call(known, 'role') ? normalize(known.role) : await readRole(userId);
    if (!isLeaderRole(role)) return { leader: false, role };
    if (role === 'principal' && await isFlagEnabledForUser(supabase, PORTAL_TEACHER_V2_KEY, userId)) return { leader: false, role };
    return { leader: true, role };
  } catch (error) {
    console.warn('⚠️ Lesson plan open: the role could not be read — recorded as a teacher open', { error: error && error.message });
    return TEACHER;
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
    return survey ? pending.then(LpOpenSurvey.afterOpen) : pending;
  }
  try {
    telemetry.logEvent(EVENT, {
      userId: open.userId, role: reader.role, kind: open.kind, ref: open.ref, source: open.source,
    });
  } catch (_) { /* a log line never costs the plan */ }
  if (!renderId) return Promise.resolve({ recorded: false, leader: true });
  return Promise.resolve()
    .then(() => Notices.markOpened(query, open.userId, `lesson:${renderId}`))
    .catch((error) => {
      console.error('❌ Lesson plan open: a leader\'s request not marked opened', { error: error && error.message });
    })
    .then(() => ({ recorded: false, leader: true }));
}

module.exports = { EVENT, readerOf, recordOpen };
