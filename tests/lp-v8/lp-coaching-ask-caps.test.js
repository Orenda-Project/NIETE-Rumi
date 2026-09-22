'use strict';
/**
 * 4.4 — the caps, as pure functions over the teacher's own history.
 *
 * Everything the ask is allowed to do to a teacher's week lives here: at most
 * LP_COACHING_ASK_WEEKLY_CAP asks in a rolling seven days, never two days
 * running, and a full stop for thirty days once three in a row came back "Not
 * today". Pure on purpose — the send handler reads one function and does not
 * get to re-litigate the rule per branch.
 *
 * The histories below are synthetic and the rule is asserted at its edge in
 * both directions, because a cap that is one row out is silent in production.
 */

const Caps = require('../../bot/shared/services/nudges/caps');

const DAY = 24 * 60 * 60 * 1000;
const d = (base, offset) => new Date(Date.parse(`${base}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
const TODAY = '2026-09-22';                      // Tuesday

const row = (date, over = {}) => ({
  id: `n-${date}`, kind: 'coaching_after_lp', nudge_date: date,
  status: 'sent', choice: null, ...over,
});

describe('weekly cap', () => {
  test('under the cap passes', () => {
    const rows = [row(d(TODAY, -3))];
    expect(Caps.weeklyCapReached(rows, { nudgeDate: TODAY, cap: 2 })).toBe(false);
  });

  test('at the cap blocks', () => {
    const rows = [row(d(TODAY, -1)), row(d(TODAY, -3))];
    expect(Caps.weeklyCapReached(rows, { nudgeDate: TODAY, cap: 2 })).toBe(true);
  });

  test('the window is seven days — an eighth-day send does not count', () => {
    const rows = [row(d(TODAY, -7)), row(d(TODAY, -3))];
    expect(Caps.weeklyCapReached(rows, { nudgeDate: TODAY, cap: 2 })).toBe(false);
  });

  test('only rows that actually went out count — skipped and failed do not', () => {
    const rows = [
      row(d(TODAY, -1), { status: 'skipped' }),
      row(d(TODAY, -2), { status: 'failed' }),
      row(d(TODAY, -3), { status: 'pending' }),
    ];
    expect(Caps.weeklyCapReached(rows, { nudgeDate: TODAY, cap: 2 })).toBe(false);
  });

  test('a cap of 0 blocks everything, and it is not mistaken for "unset"', () => {
    expect(Caps.weeklyCapReached([], { nudgeDate: TODAY, cap: 0 })).toBe(true);
  });
});

describe('never two days running', () => {
  test('a send yesterday blocks today', () => {
    expect(Caps.sentYesterday([row(d(TODAY, -1))], { nudgeDate: TODAY })).toBe(true);
  });

  test('a send two days ago does not', () => {
    expect(Caps.sentYesterday([row(d(TODAY, -2))], { nudgeDate: TODAY })).toBe(false);
  });

  test('a row yesterday that was skipped is not a send', () => {
    expect(Caps.sentYesterday([row(d(TODAY, -1), { status: 'skipped' })], { nudgeDate: TODAY })).toBe(false);
  });
});

describe('three declines pause the ask', () => {
  test('three "no" in a row pauses', () => {
    const rows = [-2, -5, -9].map((o) => row(d(TODAY, o), { choice: 'no' }));
    expect(Caps.declinedStreak(rows, { nudgeDate: TODAY })).toBe(true);
  });

  test('a "yes" anywhere in the last three breaks the streak', () => {
    const rows = [
      row(d(TODAY, -2), { choice: 'no' }),
      row(d(TODAY, -5), { choice: 'yes' }),
      row(d(TODAY, -9), { choice: 'no' }),
    ];
    expect(Caps.declinedStreak(rows, { nudgeDate: TODAY })).toBe(false);
  });

  test('an ignored ask is neutral, not a decline — it neither pauses nor counts as the third', () => {
    const rows = [
      row(d(TODAY, -2), { choice: 'ignored' }),
      row(d(TODAY, -5), { choice: 'no' }),
      row(d(TODAY, -9), { choice: 'no' }),
    ];
    expect(Caps.declinedStreak(rows, { nudgeDate: TODAY })).toBe(false);
  });

  test('two declines are not three', () => {
    const rows = [-2, -5].map((o) => row(d(TODAY, o), { choice: 'no' }));
    expect(Caps.declinedStreak(rows, { nudgeDate: TODAY })).toBe(false);
  });

  test('declines older than thirty days are out of the window and the pause lifts', () => {
    const rows = [-31, -35, -40].map((o) => row(d(TODAY, o), { choice: 'no' }));
    expect(Caps.declinedStreak(rows, { nudgeDate: TODAY })).toBe(false);
  });
});

describe('the ladder answers with the FIRST reason, in ladder order', () => {
  test('a clean history has no cap reason', () => {
    expect(Caps.capReason([], { nudgeDate: TODAY, cap: 2 })).toBeNull();
  });

  test('the weekly cap is reported before the consecutive day', () => {
    const rows = [row(d(TODAY, -1)), row(d(TODAY, -3))];
    expect(Caps.capReason(rows, { nudgeDate: TODAY, cap: 2 })).toBe('weekly_cap');
  });

  test('a lone send yesterday reports consecutive_day', () => {
    expect(Caps.capReason([row(d(TODAY, -1))], { nudgeDate: TODAY, cap: 3 })).toBe('consecutive_day');
  });

  test('three declines report declined_streak', () => {
    const rows = [-3, -6, -9].map((o) => row(d(TODAY, o), { choice: 'no' }));
    expect(Caps.capReason(rows, { nudgeDate: TODAY, cap: 9 })).toBe('declined_streak');
  });

  test('every reason it can return is a SKIP_REASONS value the store knows', () => {
    const known = ['weekly_cap', 'consecutive_day', 'declined_streak'];
    expect(Caps.CAP_REASONS).toEqual(known);
  });
});
