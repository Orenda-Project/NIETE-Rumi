/**
 * The coach School Card's periods: Today, This week, This month, in Pakistan time.
 *
 *   week   Monday to today; one bucket per school day Mon-Fri, days still ahead are `future`.
 *   month  the 1st to today; one bucket per Monday-start week overlapping the month, a week cut by the
 *          month edge or by today is `partial`, a week that has not started is `future`.
 *   today  today only, no buckets.
 * schoolDaysSoFar counts Mon-Fri days in [from, to]. A timestamp's day is its Pakistan day (UTC+5).
 */
const P = require('../../dashboard/lib/school-card-period');

const dates = (p) => p.buckets.map((b) => b.date);
const flags = (p, k) => p.buckets.map((b) => b[k]);

describe('This week', () => {
  test('a Wednesday: Monday to today, Thu and Fri are future slots, 3 school days so far', () => {
    const p = P.periodOf('week', '2026-10-28');
    expect(p).toMatchObject({ key: 'week', from: '2026-10-26', to: '2026-10-28', today: '2026-10-28', schoolDaysSoFar: 3 });
    expect(dates(p)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(p.buckets.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(flags(p, 'future')).toEqual([false, false, false, true, true]);
    expect(flags(p, 'partial')).toEqual([false, false, false, false, false]);
    expect(p.buckets[0].key).toBe('2026-10-26');
  });

  test('a Monday: the week is that day alone, 1 school day, four future slots', () => {
    const p = P.periodOf('week', '2026-10-26');
    expect(p).toMatchObject({ from: '2026-10-26', to: '2026-10-26', schoolDaysSoFar: 1 });
    expect(flags(p, 'future')).toEqual([false, true, true, true, true]);
  });

  test('a Friday: all five school days, none ahead', () => {
    const p = P.periodOf('week', '2026-10-30');
    expect(p).toMatchObject({ from: '2026-10-26', to: '2026-10-30', schoolDaysSoFar: 5 });
    expect(flags(p, 'future')).toEqual([false, false, false, false, false]);
  });

  test('a Sunday: the week runs to Sunday, still 5 school days and five buckets', () => {
    const p = P.periodOf('week', '2026-11-01');
    expect(p).toMatchObject({ from: '2026-10-26', to: '2026-11-01', schoolDaysSoFar: 5 });
    expect(dates(p)).toHaveLength(5);
  });

  test('a week that crosses a month end keeps its Monday', () => {
    expect(P.periodOf('week', '2026-10-01').from).toBe('2026-09-28');
  });
});

describe('This month', () => {
  test('October 2026 starts on a Thursday: Wk 1 is the week of Mon 28 Sep, partial; Wk 5 is cut by today', () => {
    const p = P.periodOf('month', '2026-10-28');
    expect(p).toMatchObject({ key: 'month', from: '2026-10-01', to: '2026-10-28', schoolDaysSoFar: 20 });
    expect(dates(p)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(p.buckets.map((b) => b.label)).toEqual(['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', 'Wk 5']);
    expect(p.buckets.map((b) => b.key)).toEqual(['wk1', 'wk2', 'wk3', 'wk4', 'wk5']);
    expect(flags(p, 'partial')).toEqual([true, false, false, false, true]);
    expect(flags(p, 'future')).toEqual([false, false, false, false, false]);
  });

  test('the 1st of the month: one school day so far, later weeks are future', () => {
    const p = P.periodOf('month', '2026-10-01');
    expect(p).toMatchObject({ from: '2026-10-01', to: '2026-10-01', schoolDaysSoFar: 1 });
    expect(flags(p, 'future')).toEqual([false, true, true, true, true]);
    expect(flags(p, 'partial')).toEqual([true, false, false, false, false]);
  });

  test('a month that starts on a Monday has no partial first week', () => {
    const p = P.periodOf('month', '2026-06-30'); // June 2026: Mon 1 to Tue 30
    expect(dates(p)[0]).toBe('2026-06-01');
    expect(p.buckets[0].partial).toBe(false);
    expect(p.schoolDaysSoFar).toBe(22);
    expect(p.buckets[p.buckets.length - 1]).toMatchObject({ date: '2026-06-29', partial: true, future: false });
  });

  test('a month that starts on a Saturday: its first bucket holds only the weekend', () => {
    const p = P.periodOf('month', '2026-08-03'); // 1 Aug 2026 is a Saturday
    expect(dates(p).slice(0, 2)).toEqual(['2026-07-27', '2026-08-03']);
    expect(p.buckets[0]).toMatchObject({ partial: true, future: false });
    expect(p.schoolDaysSoFar).toBe(1);
  });
});

describe('Today', () => {
  test('one day, no buckets; a weekday is one school day', () => {
    expect(P.periodOf('today', '2026-10-28')).toEqual({
      key: 'today', from: '2026-10-28', to: '2026-10-28', today: '2026-10-28', schoolDaysSoFar: 1, buckets: [],
    });
  });

  test('a Saturday is no school day', () => {
    expect(P.periodOf('today', '2026-10-31').schoolDaysSoFar).toBe(0);
  });
});

describe('the period key', () => {
  test('week is the default; anything else is refused', () => {
    expect(P.parsePeriodKey(undefined)).toBe('week');
    expect(P.parsePeriodKey('')).toBe('week');
    expect(P.parsePeriodKey('month')).toBe('month');
    expect(P.parsePeriodKey('today')).toBe('today');
    expect(P.parsePeriodKey('year')).toBeNull();
    expect(P.parsePeriodKey(['week'])).toBeNull();
  });
});

describe('Pakistan days', () => {
  test('midnight PKT is 19:00 UTC the day before', () => {
    expect(P.pkDayOf('2026-10-27T18:59:59.999Z')).toBe('2026-10-27');
    expect(P.pkDayOf('2026-10-27T19:00:00.000Z')).toBe('2026-10-28');
    expect(P.pkDayOf(new Date('2026-10-27T19:00:00Z'))).toBe('2026-10-28');
    expect(P.pkDayOf(null)).toBeNull();
    expect(P.pkDayOf('not a date')).toBeNull();
  });

  test('the read window is [from 00:00 PKT, to+1 00:00 PKT) as UTC instants', () => {
    const p = P.periodOf('week', '2026-10-28');
    expect(P.boundsOf(p)).toEqual({ fromTs: '2026-10-25T19:00:00.000Z', toTs: '2026-10-28T19:00:00.000Z' });
  });

  test('a day lands in its bucket; a weekend day in the week view lands in none', () => {
    const week = P.periodOf('week', '2026-11-01');
    expect(P.bucketIndexOf(week, '2026-10-26')).toBe(0);
    expect(P.bucketIndexOf(week, '2026-10-30')).toBe(4);
    expect(P.bucketIndexOf(week, '2026-10-31')).toBe(-1);
    const month = P.periodOf('month', '2026-10-28');
    expect(P.bucketIndexOf(month, '2026-10-01')).toBe(0);
    expect(P.bucketIndexOf(month, '2026-10-04')).toBe(0); // a Sunday still belongs to its week
    expect(P.bucketIndexOf(month, '2026-10-05')).toBe(1);
    expect(P.bucketIndexOf(month, '2026-09-30')).toBe(-1); // before the month
    expect(P.bucketIndexOf(month, '2026-10-29')).toBe(-1); // after today
  });

  test('inPeriod is both ends inclusive', () => {
    const p = P.periodOf('week', '2026-10-28');
    expect(P.inPeriod(p, '2026-10-26')).toBe(true);
    expect(P.inPeriod(p, '2026-10-28')).toBe(true);
    expect(P.inPeriod(p, '2026-10-25')).toBe(false);
    expect(P.inPeriod(p, '2026-10-29')).toBe(false);
  });

  test('a school day is Monday to Friday', () => {
    expect(P.isSchoolDay('2026-10-30')).toBe(true);
    expect(P.isSchoolDay('2026-10-31')).toBe(false);
    expect(P.isSchoolDay('2026-11-01')).toBe(false);
  });
});

describe('the previous period, for the score averages', () => {
  test('today -> yesterday; week -> the whole week before; month -> the whole month before', () => {
    expect(P.previousOf(P.periodOf('today', '2026-10-28'))).toEqual({ from: '2026-10-27', to: '2026-10-27' });
    expect(P.previousOf(P.periodOf('week', '2026-10-28'))).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(P.previousOf(P.periodOf('month', '2026-10-28'))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(P.previousOf(P.periodOf('month', '2026-01-15'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('the public shape', () => {
  test('publicPeriod is exactly the contract fields', () => {
    const p = P.periodOf('week', '2026-10-28');
    expect(Object.keys(P.publicPeriod(p)).sort()).toEqual(['buckets', 'from', 'key', 'schoolDaysSoFar', 'to', 'today']);
  });
});
