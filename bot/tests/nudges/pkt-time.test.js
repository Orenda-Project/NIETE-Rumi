'use strict';
/**
 * The teacher-nudge core — `bot/shared/services/nudges/pkt-time.js`.
 *
 * Everything a scheduled nudge needs to answer "which school day is this, and
 * may we speak now". PKT is UTC+5 with no DST, which is the only reason this
 * can be arithmetic instead of a timezone database — and the reason every case
 * below is pinned to a fixed instant rather than `new Date()`.
 *
 * The cases that matter are the ones a wrong sign or an off-by-one hour would
 * pass anyway: a lesson delivered at 19:30 UTC belongs to TOMORROW in Pakistan,
 * a Friday's next school day is Monday, and the quiet window's two edges
 * (exactly 21:00 and exactly 07:00 PKT) fall on opposite sides of the rule.
 *
 * `deferQuietHours` is asserted twice, deliberately: once for its behaviour
 * against the REAL transcript-quiz nudge rule, and once for the fact that it
 * DELEGATES rather than carrying a second copy of 21:00–07:00. A copied rule
 * passes every behavioural test on the day it is written and silently diverges
 * the first time the quiet window moves.
 */

// The quiet-hours rule lives in the transcript-quiz nudge service, whose require
// chain reaches the database and WhatsApp. Mock ONLY those boundaries so the real
// rule still executes.
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendButtons: jest.fn(),
}));
jest.mock('../../shared/utils/structured-logger', () => ({
  logEvent: jest.fn(),
  generateCorrelationId: () => 'test',
  runWithCorrelation: (_id, fn) => fn(),
  getCurrentCorrelationId: () => 'test',
}));

const pkt = require('../../shared/services/nudges/pkt-time');

/** 2026-09-22 is a Tuesday; 09-25 Friday; 09-26 Saturday; 09-28 Monday. */
const at = (iso) => new Date(iso);

describe('pktDate / pktHour / pktMinute — PKT is UTC+5, no DST', () => {
  test('a lesson delivered at 19:30 UTC belongs to the NEXT Pakistani day', () => {
    expect(pkt.pktDate(at('2026-09-22T19:30:00Z'))).toBe('2026-09-23');
    expect(pkt.pktHour(at('2026-09-22T19:30:00Z'))).toBe(0);
    expect(pkt.pktMinute(at('2026-09-22T19:30:00Z'))).toBe(30);
  });

  test('one second before that boundary is still the same Pakistani day', () => {
    expect(pkt.pktDate(at('2026-09-22T18:59:59Z'))).toBe('2026-09-22');
    expect(pkt.pktHour(at('2026-09-22T18:59:59Z'))).toBe(23);
    expect(pkt.pktMinute(at('2026-09-22T18:59:59Z'))).toBe(59);
  });

  test('midday UTC is the afternoon in Pakistan', () => {
    expect(pkt.pktDate(at('2026-09-22T10:00:00Z'))).toBe('2026-09-22');
    expect(pkt.pktHour(at('2026-09-22T10:00:00Z'))).toBe(15);
  });

  test('month and year boundaries are carried, not truncated', () => {
    expect(pkt.pktDate(at('2026-12-31T19:00:00Z'))).toBe('2027-01-01');
    expect(pkt.pktDate(at('2026-02-28T20:15:00Z'))).toBe('2026-03-01');
  });

  test('the date is zero-padded so it sorts and compares as a string', () => {
    expect(pkt.pktDate(at('2027-01-04T06:00:00Z'))).toBe('2027-01-04');
  });
});

describe('isSchoolDay — Monday to Friday', () => {
  test.each([
    ['2026-09-21', true, 'Monday'],
    ['2026-09-22', true, 'Tuesday'],
    ['2026-09-25', true, 'Friday'],
    ['2026-09-26', false, 'Saturday'],
    ['2026-09-27', false, 'Sunday'],
    ['2026-09-28', true, 'Monday'],
  ])('%s → %s (%s)', (date, expected) => {
    expect(pkt.isSchoolDay(date)).toBe(expected);
  });

  test('reads the calendar date as PKT, never as the host machine\'s local day', () => {
    // A machine in UTC-7 parsing '2026-09-28' with `new Date(str)` local-time
    // semantics would land on Sunday the 27th. The answer must not depend on TZ.
    expect(pkt.isSchoolDay('2026-09-28')).toBe(true);
    expect(pkt.isSchoolDay('2026-09-27')).toBe(false);
  });
});

describe('nextSchoolDay', () => {
  test('Friday → Monday (the weekend is skipped whole)', () => {
    expect(pkt.nextSchoolDay('2026-09-25')).toBe('2026-09-28');
  });
  test('Saturday → Monday, Sunday → Monday', () => {
    expect(pkt.nextSchoolDay('2026-09-26')).toBe('2026-09-28');
    expect(pkt.nextSchoolDay('2026-09-27')).toBe('2026-09-28');
  });
  test('Tuesday → Wednesday', () => {
    expect(pkt.nextSchoolDay('2026-09-22')).toBe('2026-09-23');
  });
  test('crosses the year end (Thursday 31 Dec → Friday 1 Jan)', () => {
    expect(pkt.nextSchoolDay('2026-12-31')).toBe('2027-01-01');
    // …and Friday 1 Jan → Monday 4 Jan.
    expect(pkt.nextSchoolDay('2027-01-01')).toBe('2027-01-04');
  });
});

describe('atPkt — a PKT wall-clock time as a UTC instant', () => {
  test('15:00 PKT on 23 Sep is 10:00 UTC', () => {
    expect(pkt.atPkt('2026-09-23', 15, 0).toISOString()).toBe('2026-09-23T10:00:00.000Z');
  });
  test('a morning hour rolls back into the previous UTC day', () => {
    expect(pkt.atPkt('2026-09-23', 3, 30).toISOString()).toBe('2026-09-22T22:30:00.000Z');
  });
  test('minutes default to 0', () => {
    expect(pkt.atPkt('2026-09-23', 15).toISOString()).toBe('2026-09-23T10:00:00.000Z');
  });
  test('round-trips with pktDate/pktHour', () => {
    const d = pkt.atPkt('2026-09-23', 15, 0);
    expect(pkt.pktDate(d)).toBe('2026-09-23');
    expect(pkt.pktHour(d)).toBe(15);
  });
});

describe('deferQuietHours — nothing reaches a teacher between 21:00 and 07:00 PKT', () => {
  test('an afternoon instant is returned unchanged', () => {
    const noon = at('2026-09-22T10:00:00Z');           // 15:00 PKT
    expect(pkt.deferQuietHours(noon).toISOString()).toBe(noon.toISOString());
  });

  test('22:00 PKT is deferred to 07:00 PKT the next morning', () => {
    // 17:00Z = 22:00 PKT on the 22nd → 07:00 PKT on the 23rd = 02:00Z.
    expect(pkt.deferQuietHours(at('2026-09-22T17:00:00Z')).toISOString())
      .toBe('2026-09-23T02:00:00.000Z');
  });

  test('06:00 PKT is deferred to 07:00 PKT the SAME morning', () => {
    // 01:00Z = 06:00 PKT → 07:00 PKT the same day = 02:00Z.
    expect(pkt.deferQuietHours(at('2026-09-22T01:00:00Z')).toISOString())
      .toBe('2026-09-22T02:00:00.000Z');
  });

  test('the two edges fall on opposite sides: 21:00 PKT is quiet, 07:00 PKT is not', () => {
    // exactly 21:00 PKT = 16:00Z → quiet, pushed to the next morning
    expect(pkt.deferQuietHours(at('2026-09-22T16:00:00Z')).toISOString())
      .toBe('2026-09-23T02:00:00.000Z');
    // exactly 07:00 PKT = 02:00Z → allowed, unchanged
    const seven = at('2026-09-22T02:00:00Z');
    expect(pkt.deferQuietHours(seven).toISOString()).toBe(seven.toISOString());
  });

  test('a deferral always lands on an instant that is itself outside the quiet window', () => {
    for (const iso of ['2026-09-22T16:00:00Z', '2026-09-22T17:30:00Z', '2026-09-22T20:10:00Z', '2026-09-22T00:05:00Z']) {
      const out = pkt.deferQuietHours(at(iso));
      const h = pkt.pktHour(out);
      expect(h).toBeGreaterThanOrEqual(7);
      expect(h).toBeLessThan(21);
    }
  });

  test('DELEGATES to transcript-quiz-nudge.nudgeTargetUtc — it does not hold a second copy of the rule', () => {
    jest.isolateModules(() => {
      const spy = jest.fn(() => new Date('2031-01-01T00:00:00Z'));
      jest.doMock('../../shared/services/quiz/transcript-quiz-nudge.service', () => ({
        nudgeTargetUtc: spy,
        QUIET_FROM_PKT: 21,
        QUIET_TO_PKT: 7,
      }));
      const fresh = require('../../shared/services/nudges/pkt-time');
      const when = new Date('2026-09-22T17:00:00Z');
      const out = fresh.deferQuietHours(when);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].toISOString()).toBe(when.toISOString());
      // If pkt-time computed the answer itself, the stub's sentinel would be ignored.
      expect(out.toISOString()).toBe('2031-01-01T00:00:00.000Z');
    });
  });

  test('quietAwareDeadline DELEGATES to transcript-quiz-nudge.quietAwareDeadlineUtc, in milliseconds', () => {
    jest.isolateModules(() => {
      const spy = jest.fn(() => new Date('2031-01-01T00:00:00Z'));
      jest.doMock('../../shared/services/quiz/transcript-quiz-nudge.service', () => ({
        quietAwareDeadlineUtc: spy,
      }));
      const fresh = require('../../shared/services/nudges/pkt-time');
      const start = new Date('2026-09-22T14:00:00Z');
      const out = fresh.quietAwareDeadline(start, 21600);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].toISOString()).toBe(start.toISOString());
      expect(spy.mock.calls[0][1]).toBe(21600 * 1000);
      expect(out.toISOString()).toBe('2031-01-01T00:00:00.000Z');
    });
  });
});
