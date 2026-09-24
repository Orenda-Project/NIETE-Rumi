'use strict';
/**
 * PKT calendar arithmetic for scheduled teacher nudges.
 *
 * Pakistan Standard Time is UTC+5 and has no daylight saving, so "which school
 * day is this" is arithmetic, not a timezone database. That is worth stating
 * once, here, because the alternative — letting each caller reach for
 * `new Date()` and the host's local day — is how a worker running in UTC decides
 * that a lesson delivered at 19:30 belongs to yesterday and schedules a 15:00
 * offer for a day that has already gone.
 *
 * Every function takes the instant or the date it works on. Nothing in this file
 * reads the clock unless the caller declines to pass one, which is what makes
 * the whole nudge stack testable at fixed instants.
 *
 * A `dateStr` here is always a PKT calendar date, `YYYY-MM-DD`, zero-padded so
 * it sorts and compares as a plain string (it is also exactly what the
 * `teacher_nudges.nudge_date` DATE column round-trips).
 */

/** PKT = UTC+5, year round. */
const PKT_OFFSET_MIN = 5 * 60;
const PKT_OFFSET_MS = PKT_OFFSET_MIN * 60 * 1000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The instant `now`, shifted so its UTC fields read as PKT wall-clock fields. */
function shifted(now) {
  const d = now instanceof Date ? now : new Date(now);
  return new Date(d.getTime() + PKT_OFFSET_MS);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** The PKT calendar date of `now`, as 'YYYY-MM-DD'. */
function pktDate(now = new Date()) {
  const p = shifted(now);
  return `${p.getUTCFullYear()}-${pad(p.getUTCMonth() + 1)}-${pad(p.getUTCDate())}`;
}

/** The PKT wall-clock hour of `now`, 0–23. */
function pktHour(now = new Date()) {
  return shifted(now).getUTCHours();
}

/** The PKT wall-clock minute of `now`, 0–59. */
function pktMinute(now = new Date()) {
  return shifted(now).getUTCMinutes();
}

/**
 * The parts of a 'YYYY-MM-DD' string. Parsed by hand rather than by `new Date(str)`
 * so the answer can never depend on the host's timezone.
 */
function parts(dateStr) {
  const m = DATE_RE.exec(String(dateStr || ''));
  if (!m) throw new Error(`pkt-time: expected a YYYY-MM-DD date, got ${JSON.stringify(dateStr)}`);
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

/** Monday–Friday. Public holidays are NOT modelled. */
function isSchoolDay(dateStr) {
  const { y, mo, d } = parts(dateStr);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** The next Mon–Fri strictly after `dateStr`. Friday → Monday. */
function nextSchoolDay(dateStr) {
  const { y, mo, d } = parts(dateStr);
  const cur = new Date(Date.UTC(y, mo - 1, d));
  for (let i = 1; i <= 7; i++) {
    const next = new Date(cur.getTime() + i * 24 * 60 * 60 * 1000);
    const iso = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
    if (isSchoolDay(iso)) return iso;
  }
  /* istanbul ignore next — a seven-day window always contains a weekday. */
  throw new Error(`pkt-time: no school day within a week of ${dateStr}`);
}

/**
 * A PKT wall-clock time on a PKT calendar date, as the UTC instant it is.
 * `atPkt('2026-09-23', 15, 0)` → 2026-09-23T10:00:00.000Z.
 */
function atPkt(dateStr, hour, minute = 0) {
  const { y, mo, d } = parts(dateStr);
  return new Date(Date.UTC(y, mo - 1, d, hour, minute, 0, 0) - PKT_OFFSET_MS);
}

/**
 * When a nudge due at `when` may actually be sent — `when` itself during the
 * day, or 07:00 PKT when it falls in the 21:00–07:00 quiet window.
 *
 * DELEGATED, not copied. The rule already exists in the transcript-quiz nudge
 * service and is exercised there by the live quiz nudges; a second copy of
 * "21:00 to 07:00" would pass every test the day it was written and diverge the
 * first time the window moves. Required at call time so this module stays free
 * of the database and WhatsApp chains that service pulls in at load.
 */
function deferQuietHours(when = new Date()) {
  const { nudgeTargetUtc } = require('../quiz/transcript-quiz-nudge.service');
  return nudgeTargetUtc(when instanceof Date ? when : new Date(when));
}

/**
 * When a wait of `seconds` that counts only WAKING time ends, starting at
 * `start` — the quiet window's hours do not run it down. Six hours from 19:00
 * PKT ends at 11:00 the next morning; from 10:00, at 16:00.
 *
 * DELEGATED for the same reason as deferQuietHours: the window lives in one
 * place, and this reads it there.
 */
function quietAwareDeadline(start = new Date(), seconds = 0) {
  const { quietAwareDeadlineUtc } = require('../quiz/transcript-quiz-nudge.service');
  return quietAwareDeadlineUtc(start instanceof Date ? start : new Date(start), seconds * 1000);
}

module.exports = {
  PKT_OFFSET_MIN,
  pktDate,
  pktHour,
  pktMinute,
  isSchoolDay,
  nextSchoolDay,
  atPkt,
  deferQuietHours,
  quietAwareDeadline,
};
