'use strict';
/**
 * bd-ptl6x9.7 — the weekly weak-skill Jugnu nudge, run as the teacher-nudge sweeper's `weak_skill_jugnu` kind
 * (workers/sqs-worker.js requires this module; it registers itself at load). Modelled on coaching/weekly-report/job.js.
 *
 *   prepare  Saturday 09:00–21:00 PKT, switch on: one teacher_nudges row per reached teacher (a Jugnu class list;
 *            test accounts only unless the audience says 'all'), keyed on the week's Monday. UNIQUE (user_id, kind,
 *            nudge_date) makes it once per teacher per week.
 *   send     one claimed row → the teacher's class lists → per school+grade, the children's maths-check results of
 *            the last 8 weeks → the picker → one template message whose button forwards that game to families.
 *            Nothing to name (every group under 5, or nothing under the line) → a logged skip. Off, out of the
 *            window, or a template Meta has not approved → a logged skip. There is NO free-form fallback.
 *
 * Events: weak_skill_jugnu.sent | skipped | failed, with userId — never a child count.
 */

const store = require('../teacher-nudges.store');
const reader = require('./reader');
const { nudgeSettings } = require('./switch');
const { pick } = require('./picker');
const { buildMessage } = require('./message');
const LINKS = require('./links.json');
const { weekOf, inSendWindow } = require('../../coaching/weekly-report/week');
const { signTeacherReport } = require('../../quiz/teacher-report-token');
const { logEvent } = require('../../../utils/structured-logger');
const { logToFile } = require('../../../utils/logger');

const KIND = store.KINDS.WEAK_SKILL_JUGNU;
const WINDOW_DAYS = 56; // 8 weeks pooled: one week alone rarely reaches 5 tested children in a school+grade
const DAY_MS = 24 * 60 * 60 * 1000;
const REFUSED_CODES = new Set([132001, 132015, 132016]); // template not found / paused / disabled
const BLOCK_MS = 60 * 60 * 1000;

let scheduledWeek = null;
let offSaidFor = null;
const blocked = new Map();

const event = (outcome, data) => logEvent(`weak_skill_jugnu.${outcome}`, data);

async function prepare({ now = new Date() } = {}) {
  if (!inSendWindow(now)) return;
  const { weekStart } = weekOf(now);
  if (scheduledWeek === weekStart) return;
  const settings = await nudgeSettings(now.getTime());
  if (!settings.enabled) {
    if (offSaidFor !== weekStart) {
      logToFile('weak-skill jugnu nudge: switch is off — nothing scheduled', { week: weekStart });
      offSaidFor = weekStart;
    }
    return;
  }
  let ids;
  try {
    ids = await reader.teachers({ testOnly: settings.testOnly });
  } catch (err) {
    logToFile('❌ weak-skill jugnu nudge: cohort read failed — retrying next tick', { error: err.message }, 'error');
    return;
  }
  scheduledWeek = weekStart;
  let created = 0;
  for (const userId of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await store.schedule({ userId, kind: KIND, nudgeDate: weekStart, scheduledAt: now, context: { week: weekStart } });
      if (r && r.created) created += 1;
    } catch (err) {
      event('failed', { userId, week: weekStart, stage: 'schedule', error: err.message });
    }
  }
  logToFile('weak-skill jugnu nudge: scheduled', { week: weekStart, cohort: ids.length, created, testOnly: settings.testOnly });
}

/** The first of the teacher's lists whose school+grade has a skill to name; each school+grade read once. */
async function firstPick(lists, window, includeTestCoaches) {
  const seen = new Map();
  for (const list of lists) {
    const key = `${list.schoolId}|${list.grade}`;
    if (!seen.has(key)) {
      // eslint-disable-next-line no-await-in-loop
      const results = await reader.groupResults({ schoolId: list.schoolId, grade: list.grade, ...window, includeTestCoaches });
      seen.set(key, pick(results, LINKS));
    }
    const picked = seen.get(key);
    if (picked) return { list, picked };
  }
  return null;
}

function isBlocked(name, nowMs) {
  const until = blocked.get(name);
  if (until && until > nowMs) return true;
  blocked.delete(name);
  return false;
}

async function send(row, { now = new Date() } = {}) {
  const userId = row.user_id;
  const week = weekOf(now);
  const base = { userId, week: row.nudge_date, nudgeId: row.id };
  const skip = (reason, extra = {}) => {
    const context = { ...base, ...extra, reason };
    event('skipped', context);
    return { skipped: reason, context };
  };

  const settings = await nudgeSettings(now.getTime());
  if (!settings.enabled) return skip('disabled');
  if (row.nudge_date !== week.weekStart || !inSendWindow(now)) return skip('window_closed');

  let msg;
  let found;
  try {
    const teacher = await reader.teacher(userId);
    if (!teacher || !teacher.phone_number) throw new Error('teacher has no live account or no phone');
    if (settings.testOnly && teacher.is_test_user !== true) return skip('disabled', { audience: 'test' });
    const lists = await reader.listsOf(userId);
    if (!lists.length) return skip('no_class_list');
    const untilIso = week.toIso;
    const sinceIso = new Date(Date.parse(untilIso) - WINDOW_DAYS * DAY_MS).toISOString();
    found = await firstPick(lists, { sinceIso, untilIso }, settings.testOnly);
    if (!found) return skip('no_weak_skill', { lists: lists.length });
    msg = buildMessage({
      picked: found.picked, grade: found.list.grade, listId: found.list.listId, teacher, token: signTeacherReport({ teacherId: userId, now: now.getTime() }),
    });
    if (!msg) throw new Error('no message could be built (no report token?)');
    msg.to = teacher.phone_number;
  } catch (err) {
    event('failed', { ...base, stage: 'read', error: err.message });
    throw err;
  }

  const detail = { template: msg.template, language: msg.language, game: msg.game, grade: found.list.grade };
  if (!settings.approved.includes(msg.template) || isBlocked(msg.template, now.getTime())) return skip('template_not_approved', detail);

  const report = {};
  const whatsapp = require('../../whatsapp.service'); // eslint-disable-line global-require
  const ok = await whatsapp.sendTemplate(msg.to, msg.template, msg.languageCode, msg.components, { report });
  if (ok) {
    const context = { ...base, ...detail };
    event('sent', context);
    return { sent: true, messageIds: [], context };
  }
  if (REFUSED_CODES.has(report.code)) {
    blocked.set(msg.template, now.getTime() + BLOCK_MS);
    return skip('template_not_approved', { ...detail, metaCode: report.code });
  }
  const err = new Error(`weak-skill jugnu nudge: template send failed (code ${report.code ?? 'none'})`);
  event('failed', { ...base, ...detail, stage: 'send', metaCode: report.code ?? null, error: err.message });
  throw err;
}

function _reset() { scheduledWeek = null; offSaidFor = null; blocked.clear(); }

try {
  require('../teacher-nudges.sweeper').register(KIND, send, { prepare }); // eslint-disable-line global-require
} catch (err) {
  logToFile('weak-skill jugnu nudge: could not register with the teacher-nudge sweeper', { error: err.message }, 'error');
}

module.exports = { prepare, send, _reset, WINDOW_DAYS };
