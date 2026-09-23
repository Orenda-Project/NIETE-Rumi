'use strict';
/**
 * WHAT THE ASK IS ALLOWED TO DO TO A TEACHER'S WEEK.
 *
 * Pure functions over `teacher-nudges.store.rowsFor()` output. No clock, no
 * database, no env: the send handler passes the rows it already read and the
 * PKT date it is sending for, and gets back one reason or null.
 *
 * Kept out of the send handler on purpose. A cap written inline is a cap
 * written once per branch, and the branch that forgets it is the one a teacher
 * meets on the third morning running.
 *
 * ── The three rules, and why each exists ────────────────────────────────────
 *
 *  weekly_cap       At most LP_COACHING_ASK_WEEKLY_CAP asks in a rolling seven
 *                   days (at most two a week). Counted on
 *                   `nudge_date`, the PKT calendar day, not on a timestamp —
 *                   the budget is a thing a teacher experiences in days.
 *  consecutive_day  Never two mornings running, whatever the weekly count says.
 *                   Two asks on Monday and Tuesday is the same two asks as
 *                   Monday and Thursday to a counter, and nothing like it to a
 *                   person.
 *  declined_streak  Three explicit "Not today" answers inside thirty days and
 *                   the ask stops for thirty days. "Ignored" is NOT a decline
 *                  : the teacher may simply have been teaching, and treating
 *                   silence as refusal is how a feature disappears for the
 *                   teachers who are busiest.
 *
 * Only rows that actually went out count. `skipped`, `failed` and `pending`
 * rows are a record of what the sweeper did, not of what a teacher received.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rolling window for the weekly cap, in days, INCLUDING the day being sent. */
const WEEK_DAYS = 7;

/** How many declines in a row pause the ask, and for how long. */
const DECLINE_STREAK = 3;
const DECLINE_WINDOW_DAYS = 30;

/** Every reason this module can return, in the order the send ladder checks them. */
const CAP_REASONS = ['weekly_cap', 'consecutive_day', 'declined_streak'];

function dayDiff(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.round((b - a) / DAY_MS);
}

/** The rows that reached the teacher, newest calendar day first. */
function sentRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.status === 'sent' && r.nudge_date)
    .sort((a, b) => (a.nudge_date < b.nudge_date ? 1 : a.nudge_date > b.nudge_date ? -1 : 0));
}

/**
 * @param {Array} rows              rowsFor() output for this kind
 * @param {{nudgeDate: string, cap: number}} opts
 * @returns {boolean} true = do not send today
 */
function weeklyCapReached(rows, { nudgeDate, cap }) {
  // A cap of 0 is a legitimate "never", not a missing value — it must block.
  const limit = Number.isFinite(Number(cap)) ? Number(cap) : Infinity;
  if (limit <= 0) return true;
  const within = sentRows(rows).filter((r) => {
    const age = dayDiff(r.nudge_date, nudgeDate);
    return age >= 0 && age < WEEK_DAYS;
  });
  return within.length >= limit;
}

/** @returns {boolean} true = an ask already went out on the calendar day before. */
function sentYesterday(rows, { nudgeDate }) {
  return sentRows(rows).some((r) => dayDiff(r.nudge_date, nudgeDate) === 1);
}

/**
 * @returns {boolean} true = the last DECLINE_STREAK asks inside the window were
 *                    all an explicit "Not today".
 */
function declinedStreak(rows, { nudgeDate, streak = DECLINE_STREAK, windowDays = DECLINE_WINDOW_DAYS } = {}) {
  const recent = sentRows(rows).filter((r) => {
    const age = dayDiff(r.nudge_date, nudgeDate);
    return age >= 0 && age <= windowDays;
  });
  if (recent.length < streak) return false;
  return recent.slice(0, streak).every((r) => r.choice === 'no');
}

/**
 * The whole ladder, in ladder order.
 * @returns {string|null} a `SKIP_REASONS` value, or null when the ask may go.
 */
function capReason(rows, { nudgeDate, cap }) {
  if (weeklyCapReached(rows, { nudgeDate, cap })) return 'weekly_cap';
  if (sentYesterday(rows, { nudgeDate })) return 'consecutive_day';
  if (declinedStreak(rows, { nudgeDate })) return 'declined_streak';
  return null;
}

module.exports = {
  CAP_REASONS,
  WEEK_DAYS,
  DECLINE_STREAK,
  DECLINE_WINDOW_DAYS,
  sentRows,
  weeklyCapReached,
  sentYesterday,
  declinedStreak,
  capReason,
};
