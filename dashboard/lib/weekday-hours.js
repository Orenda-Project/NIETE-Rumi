'use strict';
/**
 * bd-fmf24g.15 — hours that count only on weekdays, in Pakistan time.
 *
 * "Ready for you" on the teacher Home keeps a finished lesson plan or paper for 24 WEEKDAY hours
 * (Monday to Friday, Pakistan time; Saturday and Sunday do not count) or until she opens it
 * (operator, 2026-10-09). One rule, here, so the server stamps each ready item with the instant it
 * lapses and every surface compares to that.
 *
 * Pakistan has had no daylight saving since 2009 (pk-range.js), so PKT is a fixed UTC+5 and the
 * arithmetic is done on "Pakistan wall-clock milliseconds" (the instant + 5 h, read as UTC).
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PKT_OFFSET = 5 * HOUR;

const isDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
const toDate = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  return v == null || !isDate(d) ? null : d;
};
const dayOfWeek = (wall) => new Date(wall).getUTCDay(); // 0 Sun … 6 Sat, on the Pakistan date
const startOfDay = (wall) => Math.floor(wall / DAY) * DAY;
const isWeekend = (wall) => { const d = dayOfWeek(wall); return d === 0 || d === 6; };
/** Monday 00:00 on or after this wall time's weekend day. */
const nextMonday = (wall) => {
  const d = dayOfWeek(wall);
  return startOfDay(wall) + (d === 6 ? 2 : 1) * DAY;
};

/**
 * The instant `hours` weekday hours after `from`, or null when `from` is not a date.
 * Time on a Saturday or Sunday is skipped: a clock that starts then starts on Monday 00:00.
 */
function weekdayDeadline(from, hours = 24) {
  const start = toDate(from);
  if (!start || !Number.isFinite(hours) || hours < 0) return null;
  let wall = start.getTime() + PKT_OFFSET;
  let left = hours * HOUR;
  while (left > 0) {
    if (isWeekend(wall)) { wall = nextMonday(wall); continue; }
    const room = startOfDay(wall) + DAY - wall;
    const used = Math.min(room, left);
    wall += used;
    left -= used;
  }
  return new Date(wall - PKT_OFFSET);
}

/** Weekday hours between two instants (0 when `to` is not after `from`). */
function weekdayElapsedHours(from, to) {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b || b <= a) return 0;
  let wall = a.getTime() + PKT_OFFSET;
  const end = b.getTime() + PKT_OFFSET;
  let ms = 0;
  while (wall < end) {
    if (isWeekend(wall)) { wall = Math.min(nextMonday(wall), end); continue; }
    const next = Math.min(startOfDay(wall) + DAY, end);
    ms += next - wall;
    wall = next;
  }
  return ms / HOUR;
}

/** Has fewer than `hours` weekday hours passed since `from`, at `now`? */
function isWithin(from, now, hours = 24) {
  const deadline = weekdayDeadline(from, hours);
  const t = toDate(now);
  return !!deadline && !!t && t.getTime() < deadline.getTime();
}

module.exports = { weekdayDeadline, weekdayElapsedHours, isWithin };
