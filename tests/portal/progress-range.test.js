/**
 * bd-5rz1v.17 — the Home's date range, resolved as calendar periods in Pakistan time.
 *
 * The Home counts "what you did" for a range (default This month). A teacher in Islamabad
 * at 00:30 on 1 October is in October, even though the server's clock (UTC) still says
 * 30 September — so every preset is worked out from TODAY IN Asia/Karachi, and the
 * resolved `from`/`to` are Pakistan dates, inclusive.
 *
 *   this_week      Monday of this week → today
 *   this_month     the 1st → today
 *   last_3_months  the last 90 days, today included (no older convention exists in the code)
 *   this_year      1 January → today
 *   all            open at both ends
 *   custom         ?from=&to=, real YYYY-MM-DD dates, from <= to — anything else is a 400
 */

const { resolveRange, pkToday, RangeInputError } = require('../../dashboard/lib/pk-range');

// 2026-10-03 is a Saturday. 10:00 UTC = 15:00 in Pakistan.
const SAT_3_OCT = new Date('2026-10-03T10:00:00Z');

describe('today is a Pakistan date, not a UTC one', () => {
  test('19:30 UTC on 30 Sep is already 1 Oct in Pakistan', () => {
    expect(pkToday(new Date('2026-09-30T19:30:00Z'))).toBe('2026-10-01');
  });
  test('18:59 UTC on 30 Sep is still 30 Sep in Pakistan', () => {
    expect(pkToday(new Date('2026-09-30T18:59:00Z'))).toBe('2026-09-30');
  });
});

describe('presets', () => {
  test('defaults to this month', () => {
    expect(resolveRange({}, SAT_3_OCT)).toEqual({
      key: 'this_month', from: '2026-10-01', to: '2026-10-03', timezone: 'Asia/Karachi',
    });
  });

  test('this month turns over at Pakistan midnight, not UTC midnight', () => {
    // 00:30 on 1 Oct in Pakistan; UTC still says 30 Sep.
    expect(resolveRange({ range: 'this_month' }, new Date('2026-09-30T19:30:00Z')))
      .toMatchObject({ from: '2026-10-01', to: '2026-10-01' });
    // 23:59 on 30 Sep in Pakistan.
    expect(resolveRange({ range: 'this_month' }, new Date('2026-09-30T18:59:00Z')))
      .toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  });

  test('this week starts on Monday', () => {
    expect(resolveRange({ range: 'this_week' }, SAT_3_OCT)).toMatchObject({ from: '2026-09-28', to: '2026-10-03' });
    // A Monday is its own week start.
    expect(resolveRange({ range: 'this_week' }, new Date('2026-09-28T05:00:00Z')))
      .toMatchObject({ from: '2026-09-28', to: '2026-09-28' });
    // Sunday 4 Oct belongs to the week that began on Monday 28 Sep.
    expect(resolveRange({ range: 'this_week' }, new Date('2026-10-04T12:00:00Z')))
      .toMatchObject({ from: '2026-09-28', to: '2026-10-04' });
  });

  test('last 3 months is the last 90 days, today included', () => {
    expect(resolveRange({ range: 'last_3_months' }, SAT_3_OCT)).toMatchObject({ from: '2026-07-06', to: '2026-10-03' });
  });

  test('this year starts on 1 January in Pakistan', () => {
    expect(resolveRange({ range: 'this_year' }, SAT_3_OCT)).toMatchObject({ from: '2026-01-01', to: '2026-10-03' });
    // 00:10 on 1 Jan 2027 in Pakistan is 19:10 UTC on 31 Dec 2026.
    expect(resolveRange({ range: 'this_year' }, new Date('2026-12-31T19:10:00Z')))
      .toMatchObject({ from: '2027-01-01', to: '2027-01-01' });
  });

  test('all time is open at both ends', () => {
    expect(resolveRange({ range: 'all' }, SAT_3_OCT)).toEqual({
      key: 'all', from: null, to: null, timezone: 'Asia/Karachi',
    });
  });
});

describe('custom', () => {
  test('takes the two dates as given, inclusive', () => {
    expect(resolveRange({ range: 'custom', from: '2026-08-15', to: '2026-09-14' }, SAT_3_OCT))
      .toEqual({ key: 'custom', from: '2026-08-15', to: '2026-09-14', timezone: 'Asia/Karachi' });
  });

  test('one day is a valid range', () => {
    expect(resolveRange({ range: 'custom', from: '2026-09-01', to: '2026-09-01' }, SAT_3_OCT))
      .toMatchObject({ from: '2026-09-01', to: '2026-09-01' });
  });

  test.each([
    ['no dates', {}],
    ['only from', { from: '2026-09-01' }],
    ['only to', { to: '2026-09-01' }],
    ['from after to', { from: '2026-09-02', to: '2026-09-01' }],
    ['not a date', { from: 'yesterday', to: '2026-09-01' }],
    ['an injection', { from: "2026-09-01'; drop table users; --", to: '2026-09-02' }],
    ['a day that does not exist', { from: '2026-02-30', to: '2026-03-02' }],
    ['a month that does not exist', { from: '2026-13-01', to: '2026-13-02' }],
    ['a timestamp, not a date', { from: '2026-09-01T00:00:00Z', to: '2026-09-02' }],
  ])('refuses %s', (_label, dates) => {
    expect(() => resolveRange({ range: 'custom', ...dates }, SAT_3_OCT)).toThrow(RangeInputError);
  });
});

test('an unknown range is refused, not silently replaced with the default', () => {
  expect(() => resolveRange({ range: 'last_week' }, SAT_3_OCT)).toThrow(RangeInputError);
});

test('from/to on a preset are ignored, so a stale custom pair cannot leak into "This week"', () => {
  expect(resolveRange({ range: 'this_week', from: '2020-01-01', to: '2020-01-02' }, SAT_3_OCT))
    .toMatchObject({ from: '2026-09-28', to: '2026-10-03' });
});
