'use strict';
/**
 * bd-v0toag.32 — the v10 group B weekly usage report, run as the teacher-nudge sweeper's
 * `weekly_usage_report` kind (workers/sqs-worker.js requires this module; it registers itself at load).
 *
 *   prepare  Saturday 09:00–21:00 PKT, switch on: one teacher_nudges row per group B teacher, keyed on the
 *            week's Monday. UNIQUE (user_id, kind, nudge_date) makes it once per teacher per week — a
 *            restart or a second worker re-inserts nothing.
 *   send     one claimed row → read the week → summarise → one template message. Off, out of the window,
 *            or a template Meta has not approved → a logged skip. There is NO free-form fallback.
 *
 * Every outcome logs v10.weekly_report.sent | skipped | failed with userId + group.
 */

const store = require('../../nudges/teacher-nudges.store');
const reader = require('./reader');
const { reportSettings } = require('./switch');
const { weekOf, inSendWindow } = require('./week');
const { summarise } = require('./summarise');
const { buildMessage } = require('./message');
const { logEvent } = require('../../../utils/structured-logger');
const { logToFile } = require('../../../utils/logger');

const GROUP = 'B';
const KIND = store.KINDS.WEEKLY_USAGE_REPORT;
const REFUSED_CODES = new Set([132001, 132015, 132016]); // template not found / paused / disabled
const BLOCK_MS = 60 * 60 * 1000;

let scheduledWeek = null; // the week this process has already scheduled
let offSaidFor = null; //    the week the "switch is off" line was written for
const blocked = new Map(); // template name → blocked until (ms)

const event = (outcome, data) => logEvent(`v10.weekly_report.${outcome}`, { group: GROUP, ...data });

async function prepare({ now = new Date() } = {}) {
  if (!inSendWindow(now)) return;
  const { weekStart } = weekOf(now);
  if (scheduledWeek === weekStart) return;
  const settings = await reportSettings(now.getTime());
  if (!settings.enabled) {
    if (offSaidFor !== weekStart) {
      logToFile('v10 weekly report: switch is off — nothing scheduled', { week: weekStart });
      offSaidFor = weekStart;
    }
    return;
  }

  let ids;
  try {
    ids = await reader.groupBTeachers();
  } catch (err) {
    logToFile('❌ v10 weekly report: cohort read failed — retrying next tick', { error: err.message }, 'error');
    return;
  }
  scheduledWeek = weekStart;

  let created = 0;
  for (const userId of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await store.schedule({
        userId, kind: KIND, nudgeDate: weekStart, scheduledAt: now, context: { group: GROUP, week: weekStart },
      });
      if (r && r.created) created += 1;
    } catch (err) {
      event('failed', { userId, week: weekStart, stage: 'schedule', error: err.message });
    }
  }
  logToFile('v10 weekly report: scheduled', { week: weekStart, cohort: ids.length, created });
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

  const settings = await reportSettings(now.getTime());
  if (!settings.enabled) return skip('disabled');
  if (row.nudge_date !== week.weekStart || !inSendWindow(now)) return skip('window_closed');

  let msg;
  let summary;
  try {
    const teacher = await reader.teacher(userId);
    if (!teacher || !teacher.phone_number) throw new Error('teacher has no live account or no phone');
    const rows = await reader.readWeek(userId, week);
    summary = summarise(rows);
    msg = { ...buildMessage({ summary, week, teacher }), to: teacher.phone_number };
  } catch (err) {
    event('failed', { ...base, stage: 'read', error: err.message });
    throw err;
  }

  const detail = { template: msg.template, language: msg.language, quiet: msg.quiet, counts: summary };
  if (!settings.approved.includes(msg.template) || isBlocked(msg.template, now.getTime())) {
    return skip('template_not_approved', detail);
  }

  const report = {};
  const whatsapp = require('../../whatsapp.service');
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
  const err = new Error(`v10 weekly report: template send failed (code ${report.code ?? 'none'})`);
  event('failed', { ...base, ...detail, stage: 'send', metaCode: report.code ?? null, error: err.message });
  throw err;
}

function _reset() { scheduledWeek = null; offSaidFor = null; blocked.clear(); }

try {
  require('../../nudges/teacher-nudges.sweeper').register(KIND, send, { prepare });
} catch (err) {
  logToFile('v10 weekly report: could not register with the teacher-nudge sweeper', { error: err.message }, 'error');
}

module.exports = { prepare, send, _reset };
