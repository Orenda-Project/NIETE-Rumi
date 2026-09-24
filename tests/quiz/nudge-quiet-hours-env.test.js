'use strict';
/**
 * The quiet window is configurable, and unset means exactly what it always did.
 *
 * Nothing is sent to a teacher between 21:00 and 07:00 PKT: the six-hour quiz
 * nudge, the coaching ask after a lesson plan and the afternoon quiz offer all
 * defer into the morning through ONE rule, nudgeTargetUtc. A test environment
 * needs to lift that rule for a night's testing without touching the code, so
 * NUDGE_QUIET_HOURS_PKT takes "off" (no window) or "H-H" (another window).
 * Production never sets it.
 */
const Nudge = require('../../bot/shared/services/quiz/transcript-quiz-nudge.service');
const PktTime = require('../../bot/shared/services/nudges/pkt-time');
const Ask = require('../../bot/shared/services/nudges/lp-coaching-ask.service');

// 2026-09-24 is a Thursday. PKT = UTC+5.
const atPkt = (h, m = 0) => new Date(Date.UTC(2026, 8, 24, h - 5, m));
const KEY = 'NUDGE_QUIET_HOURS_PKT';
const saved = process.env[KEY];
afterEach(() => { if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved; });

describe('unset: the 21:00–07:00 window is unchanged', () => {
  test('01:30 PKT is held until 07:00 the same morning', () => {
    delete process.env[KEY];
    expect(Nudge.nudgeTargetUtc(atPkt(1, 30)).toISOString()).toBe(atPkt(7).toISOString());
  });
  test('an unreadable value falls back to the default window, never to "no window"', () => {
    process.env[KEY] = 'sometimes';
    expect(Nudge.nudgeTargetUtc(atPkt(1, 30)).toISOString()).toBe(atPkt(7).toISOString());
  });
});

describe('off: nothing is deferred', () => {
  test('01:30 PKT is sent at 01:30', () => {
    process.env[KEY] = 'off';
    expect(Nudge.nudgeTargetUtc(atPkt(1, 30)).toISOString()).toBe(atPkt(1, 30).toISOString());
  });
  test('the coaching ask for a lesson planned at 01:00 goes out after its delay, not at 07:00', () => {
    process.env[KEY] = 'off';
    const out = Ask.scheduleFor(atPkt(1), { delay: 10 });
    expect(out.scheduledAt.toISOString()).toBe(atPkt(1, 10).toISOString());
    expect(PktTime.deferQuietHours(atPkt(1, 10)).toISOString()).toBe(atPkt(1, 10).toISOString());
  });
});

describe('H-H: another window', () => {
  test('22-6 holds 05:00 until 06:00 and lets 06:30 through', () => {
    process.env[KEY] = '22-6';
    expect(Nudge.nudgeTargetUtc(atPkt(5)).toISOString()).toBe(atPkt(6).toISOString());
    expect(Nudge.nudgeTargetUtc(atPkt(6, 30)).toISOString()).toBe(atPkt(6, 30).toISOString());
  });
  test('a daytime window 13-15 holds 14:00 until 15:00 the same day', () => {
    process.env[KEY] = '13-15';
    expect(Nudge.nudgeTargetUtc(atPkt(14)).toISOString()).toBe(atPkt(15).toISOString());
    expect(Nudge.nudgeTargetUtc(atPkt(16)).toISOString()).toBe(atPkt(16).toISOString());
  });
});
