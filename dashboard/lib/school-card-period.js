'use strict';
/**
 * The coach School Card's periods, in Pakistan time (Asia/Karachi is UTC+5 all year, no DST). Pure.
 *
 *   today  today only; no buckets.
 *   week   Monday to today. One bucket per school day, Mon-Fri, all five always present; a day still ahead
 *          is `future`. A Saturday or Sunday inside the period counts in the totals but has no bucket.
 *   month  the 1st to today. One bucket per Monday-start week that overlaps the month (its Monday may fall in
 *          the month before), labelled Wk 1..Wk n with that Monday's date. A week whose school days are cut by
 *          the month's edges or by today is `partial`; a week that has not started is `future`. Every day of
 *          the period lands in exactly one week bucket, so a month's buckets add up to its total.
 *
 * schoolDaysSoFar is the number of Mon-Fri days in [from, to] (no holiday calendar exists to read).
 * The read window is [from 00:00 PKT, to+1 00:00 PKT) as UTC instants, the same rule as
 * schools-analytics windowBounds, so every dated read stays on its column's index.
 */

const PKT_MS = 5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const PERIOD_KEYS = Object.freeze(['today', 'week', 'month']);
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const utc = (day) => Date.parse(`${day}T00:00:00Z`);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (day, n) => dayOf(utc(day) + n * DAY_MS);
/** 0 = Monday … 6 = Sunday. */
const weekdayOf = (day) => (new Date(utc(day)).getUTCDay() + 6) % 7;
const isSchoolDay = (day) => weekdayOf(day) < 5;
const mondayOf = (day) => addDays(day, -weekdayOf(day));
const maxDay = (a, b) => (a > b ? a : b);
const minDay = (a, b) => (a < b ? a : b);

function monthEndOf(day) {
  const [y, m] = day.split('-').map(Number);
  return dayOf(Date.UTC(y, m, 0));
}

/** Mon-Fri days in [from, to], both inclusive; 0 when the range is empty. */
function schoolDaysIn(from, to) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isSchoolDay(d)) n += 1;
  return n;
}

/** ?period= → its key; absent or blank is 'week'; anything else is null (the route answers 400). */
function parsePeriodKey(raw) {
  if (raw === undefined || raw === null || raw === '') return 'week';
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return PERIOD_KEYS.includes(v) ? v : null;
}

/** A timestamp (Date or ISO string) → its Pakistan day 'YYYY-MM-DD', or null. */
function pkDayOf(value) {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(t) ? dayOf(t + PKT_MS) : null;
}

function weekBuckets(today) {
  const monday = mondayOf(today);
  return DAY_LABELS.map((label, i) => {
    const date = addDays(monday, i);
    return { key: date, label, date, future: date > today, partial: false };
  });
}

function monthBuckets(from, today) {
  const end = monthEndOf(from);
  const out = [];
  for (let monday = mondayOf(from), n = 1; monday <= end; monday = addDays(monday, 7), n += 1) {
    const future = monday > today;
    // The week's school days as the period can hold them: inside the month, and not after today.
    const held = future ? 0 : schoolDaysIn(maxDay(monday, from), minDay(minDay(addDays(monday, 6), end), today));
    out.push({ key: `wk${n}`, label: `Wk ${n}`, date: monday, future, partial: !future && held < 5 });
  }
  return out;
}

/**
 * @param {'today'|'week'|'month'} key
 * @param {string} today 'YYYY-MM-DD', the Pakistan day
 */
function periodOf(key, today) {
  if (key === 'today') return { key, from: today, to: today, today, schoolDaysSoFar: isSchoolDay(today) ? 1 : 0, buckets: [] };
  if (key === 'month') {
    const from = `${today.slice(0, 8)}01`;
    return { key, from, to: today, today, schoolDaysSoFar: schoolDaysIn(from, today), buckets: monthBuckets(from, today) };
  }
  const from = mondayOf(today);
  return { key: 'week', from, to: today, today, schoolDaysSoFar: schoolDaysIn(from, today), buckets: weekBuckets(today) };
}

/** The calendar period before this one, for "previous" averages: yesterday, last Mon-Sun, last month. */
function previousOf(period) {
  if (period.key === 'today') {
    const d = addDays(period.today, -1);
    return { from: d, to: d };
  }
  if (period.key === 'month') {
    const to = addDays(period.from, -1);
    return { from: `${to.slice(0, 8)}01`, to };
  }
  return { from: addDays(period.from, -7), to: addDays(period.from, -1) };
}

/** [from 00:00 PKT, to+1 00:00 PKT) as UTC ISO instants. */
function boundsOf({ from, to }) {
  return {
    fromTs: new Date(utc(from) - PKT_MS).toISOString(),
    toTs: new Date(utc(to) + DAY_MS - PKT_MS).toISOString(),
  };
}

const inPeriod = (period, day) => !!day && day >= period.from && day <= period.to;

/** The bucket a Pakistan day lands in, or -1 (outside the period, or a weekend day in the week view). */
function bucketIndexOf(period, day) {
  if (!inPeriod(period, day)) return -1;
  if (period.key === 'week') return period.buckets.findIndex((b) => b.date === day);
  if (period.key === 'month') return period.buckets.findIndex((b) => day >= b.date && day <= addDays(b.date, 6));
  return -1;
}

/** Exactly the contract's period object. */
function publicPeriod(p) {
  return { key: p.key, from: p.from, to: p.to, today: p.today, schoolDaysSoFar: p.schoolDaysSoFar, buckets: p.buckets.map((b) => ({ ...b })) };
}

module.exports = {
  PERIOD_KEYS,
  parsePeriodKey,
  periodOf,
  previousOf,
  boundsOf,
  pkDayOf,
  inPeriod,
  bucketIndexOf,
  isSchoolDay,
  publicPeriod,
  addDays,
};
