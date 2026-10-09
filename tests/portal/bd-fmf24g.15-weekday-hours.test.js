/**
 * bd-fmf24g.15 — "Ready for you" on Home keeps an item for 24 WEEKDAY hours: Monday to Friday in
 * Pakistan time (operator, 2026-10-09). Saturday and Sunday do not count, so an item that became
 * ready on Friday evening is still there on Monday. The rule is one function; the server stamps
 * every ready item with the instant it lapses (`homeUntil`), and the app only compares to it.
 *
 * Pakistan has had no daylight saving since 2009: PKT is always UTC+5.
 */
const W = () => require('../../dashboard/lib/weekday-hours');

// 2026-10-05 is a Monday. All instants below are given in Pakistan time (+05:00).
const at = (iso) => new Date(`${iso}+05:00`);
const until = (iso) => W().weekdayDeadline(at(iso), 24).toISOString();
const pk = (iso) => at(iso).toISOString();

describe('weekdayDeadline: 24 weekday hours in Pakistan time', () => {
  beforeEach(() => jest.resetModules());

  it('midweek it is simply 24 hours later', () => {
    expect(until('2026-10-06T10:30:00')).toBe(pk('2026-10-07T10:30:00')); // Tue 10:30 -> Wed 10:30
  });

  it('Thursday evening lapses Friday evening', () => {
    expect(until('2026-10-08T18:00:00')).toBe(pk('2026-10-09T18:00:00'));
  });

  it('Friday 22:00: two hours of Friday, the weekend does not count, 22 hours of Monday', () => {
    expect(until('2026-10-09T22:00:00')).toBe(pk('2026-10-12T22:00:00'));
  });

  it('Friday 12:00 lapses Monday 12:00', () => {
    expect(until('2026-10-09T12:00:00')).toBe(pk('2026-10-12T12:00:00'));
  });

  it('ready on Saturday: the clock starts on Monday 00:00 and lapses Tuesday 00:00', () => {
    expect(until('2026-10-10T10:00:00')).toBe(pk('2026-10-13T00:00:00'));
  });

  it('ready on Sunday: the same Tuesday 00:00', () => {
    expect(until('2026-10-11T23:59:00')).toBe(pk('2026-10-13T00:00:00'));
  });

  it('the day is a PAKISTAN day: 23:30 UTC on Friday is already Saturday 04:30 in Pakistan', () => {
    // Fri 2026-10-09T23:30Z = Sat 04:30 PKT -> starts Monday 00:00 PKT, lapses Tuesday 00:00 PKT.
    expect(W().weekdayDeadline(new Date('2026-10-09T23:30:00Z'), 24).toISOString()).toBe(pk('2026-10-13T00:00:00'));
  });

  it('a Monday-morning instant that is still Sunday in UTC is a Monday in Pakistan', () => {
    // Sun 2026-10-11T20:00Z = Mon 01:00 PKT -> lapses Tue 01:00 PKT.
    expect(W().weekdayDeadline(new Date('2026-10-11T20:00:00Z'), 24).toISOString()).toBe(pk('2026-10-13T01:00:00'));
  });

  it('weekdayElapsedHours counts only Monday to Friday', () => {
    expect(W().weekdayElapsedHours(at('2026-10-09T22:00:00'), at('2026-10-12T02:00:00'))).toBeCloseTo(4, 5);
    expect(W().weekdayElapsedHours(at('2026-10-10T08:00:00'), at('2026-10-11T08:00:00'))).toBe(0);
    expect(W().weekdayElapsedHours(at('2026-10-06T08:00:00'), at('2026-10-06T07:00:00'))).toBe(0);
  });

  it('isWithin: kept while 24 weekday hours have not passed, gone after', () => {
    const readyAt = at('2026-10-09T22:00:00');
    expect(W().isWithin(readyAt, at('2026-10-12T21:59:00'), 24)).toBe(true);
    expect(W().isWithin(readyAt, at('2026-10-12T22:01:00'), 24)).toBe(false);
  });

  it('bad input is not a date: null, never NaN', () => {
    expect(W().weekdayDeadline('nonsense', 24)).toBeNull();
    expect(W().weekdayDeadline(null, 24)).toBeNull();
  });
});
