'use strict';
/**
 * bd-v0toag.32 — the weekly usage report's calendar. Pure: every function takes the instant it works on.
 *
 * The report goes out on Saturday morning PKT and covers Monday 00:00 to Saturday 00:00 PKT (the school
 * week, Monday to Friday). `weekStart` (the Monday) is the idempotency key: it is the `nudge_date` of the
 * teacher's `teacher_nudges` row, so one teacher gets one report per week however many ticks run.
 */

const { pktDate, pktHour, atPkt } = require('../../nudges/pkt-time');

const SEND_HOUR = 9; // Saturday 09:00 PKT, after the school week and before the weekend.
const LAST_SEND_HOUR = 20; // 21:00 starts the quiet hours (nudges/pkt-time).
const SATURDAY = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

function parts(dateStr) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  return { y, mo, d };
}

function addDays(dateStr, n) {
  const { y, mo, d } = parts(dateStr);
  return new Date(Date.UTC(y, mo - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

function weekday(dateStr) {
  const { y, mo, d } = parts(dateStr);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = Sunday
}

/** The PKT week `now` falls in: Monday key, Friday, and the [from, to) instants of Mon 00:00 to Sat 00:00. */
function weekOf(now = new Date()) {
  const today = pktDate(now);
  const back = (weekday(today) + 6) % 7; // days since Monday
  const weekStart = addDays(today, -back);
  return {
    weekStart,
    lastDay: addDays(weekStart, 4),
    fromIso: atPkt(weekStart, 0).toISOString(),
    toIso: atPkt(addDays(weekStart, 5), 0).toISOString(),
  };
}

/** Saturday, 09:00 up to 21:00 PKT. */
function inSendWindow(now = new Date()) {
  if (weekday(pktDate(now)) !== SATURDAY) return false;
  const h = pktHour(now);
  return h >= SEND_HOUR && h <= LAST_SEND_HOUR;
}

module.exports = { weekOf, inSendWindow, SEND_HOUR, LAST_SEND_HOUR };
