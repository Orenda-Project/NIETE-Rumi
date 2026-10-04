'use strict';
/**
 * bd-5rz1v.17 — the Home's date range: calendar periods in Pakistan time.
 *
 * A teacher in Islamabad at 00:30 on 1 October is in October, while the server's clock (UTC)
 * still says 30 September. So every preset is worked out from TODAY IN Asia/Karachi, and the
 * range is a pair of Pakistan DATES, both inclusive — the same convention the Analytics page's
 * ?from=&to= already uses (pkDay/inWindow in portal.routes.js).
 *
 *   this_week      Monday of this week → today (Pakistan's working week starts on Monday)
 *   this_month     the 1st → today                    (the default)
 *   last_3_months  the last 90 days, today included   (the code had no older convention)
 *   this_year      1 January → today
 *   all            no bounds
 *   custom         ?from=&to=, real YYYY-MM-DD dates, from <= to
 *
 * `to` is today rather than the end of the period: nothing can have happened after today, and
 * the window a count was taken over should be the window she is told.
 *
 * Anything that is not one of these is refused (RangeInputError → 400), never quietly replaced
 * by the default — a page that asked for "last week" and silently got "this month" would show a
 * number under the wrong heading.
 *
 * Pakistan has had no daylight saving since 2009, so a Pakistan date is always a fixed +05:00
 * day; the SQL side still converts with AT TIME ZONE rather than assuming the offset.
 */

const TIMEZONE = 'Asia/Karachi';
const RANGES = Object.freeze(['this_week', 'this_month', 'last_3_months', 'this_year', 'all', 'custom']);
const DEFAULT_RANGE = 'this_month';
const LAST_3_MONTHS_DAYS = 90;

class RangeInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RangeInputError';
    this.status = 400;
  }
}

/** Today's date in Pakistan, YYYY-MM-DD. */
function pkToday(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** A YYYY-MM-DD string that names a real calendar day, or null. */
function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Date rolls 2026-02-30 over to 2026-03-02; a round trip catches it.
  return d.toISOString().slice(0, 10) === value ? value : null;
}

/** Calendar arithmetic on a YYYY-MM-DD (UTC noon-free: the input has no time of day). */
function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 for Monday … 6 for Sunday. */
function mondayIndex(ymd) {
  return (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * @param {object} query  the request's query: { range?, from?, to? }
 * @param {Date} [now]
 * @returns {{ key: string, from: string|null, to: string|null, timezone: string }}
 * @throws {RangeInputError}
 */
function resolveRange(query = {}, now = new Date()) {
  const key = query.range === undefined || query.range === null || query.range === ''
    ? DEFAULT_RANGE
    : String(query.range);
  if (!RANGES.includes(key)) {
    throw new RangeInputError(`range must be one of ${RANGES.join(', ')}`);
  }

  const today = pkToday(now);
  const out = (from, to) => ({ key, from, to, timezone: TIMEZONE });

  switch (key) {
    case 'this_week': return out(addDays(today, -mondayIndex(today)), today);
    case 'this_month': return out(`${today.slice(0, 8)}01`, today);
    case 'last_3_months': return out(addDays(today, -(LAST_3_MONTHS_DAYS - 1)), today);
    case 'this_year': return out(`${today.slice(0, 4)}-01-01`, today);
    case 'all': return out(null, null);
    default: {
      const from = realDate(query.from);
      const to = realDate(query.to);
      if (!from || !to) throw new RangeInputError('a custom range needs from and to as YYYY-MM-DD dates');
      if (from > to) throw new RangeInputError('from must be on or before to');
      return out(from, to);
    }
  }
}

/**
 * SQL: timestamp column `col` falls on a Pakistan day inside [$a, $b], either end open when its
 * parameter is NULL. Written as bounds ON the column (not a function OF it), so a
 * (user_id, <col>) index can range-scan.
 */
function pkInstantWindow(col, a, b) {
  return `(${a}::date IS NULL OR ${col} >= (${a}::date)::timestamp AT TIME ZONE '${TIMEZONE}')`
    + ` AND (${b}::date IS NULL OR ${col} < (${b}::date + 1)::timestamp AT TIME ZONE '${TIMEZONE}')`;
}

/** SQL: a plain DATE column inside [$a, $b] — compared as-is, never shifted through a zone. */
function dateWindow(col, a, b) {
  return `(${a}::date IS NULL OR ${col} >= ${a}::date) AND (${b}::date IS NULL OR ${col} <= ${b}::date)`;
}

/** SQL: the Pakistan day a timestamp falls on. */
function pkDaySql(col) {
  return `(${col} AT TIME ZONE '${TIMEZONE}')::date`;
}

module.exports = {
  TIMEZONE,
  RANGES,
  DEFAULT_RANGE,
  LAST_3_MONTHS_DAYS,
  RangeInputError,
  pkToday,
  resolveRange,
  pkInstantWindow,
  dateWindow,
  pkDaySql,
};
