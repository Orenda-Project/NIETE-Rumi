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

describe('quietAwareDeadlineUtc: a wait that counts only waking hours', () => {
  const SIX_H = 6 * 60 * 60 * 1000;
  const next = (h, m = 0) => new Date(atPkt(h, m).getTime() + 24 * 60 * 60 * 1000);   // the day after
  const ends = (start) => Nudge.quietAwareDeadlineUtc(start, SIX_H).toISOString();

  test('unset (21–07): 19:00 + 6 h ends 11:00 next day; 10:00 + 6 h ends 16:00', () => {
    delete process.env[KEY];
    expect(ends(atPkt(19))).toBe(next(11).toISOString());
    expect(ends(atPkt(10))).toBe(atPkt(16).toISOString());
  });
  test('a wait that runs out exactly as the window opens ends then, not in the morning', () => {
    delete process.env[KEY];
    expect(ends(atPkt(15))).toBe(atPkt(21).toISOString());
  });
  test('a start inside the window counts from the window\'s end', () => {
    delete process.env[KEY];
    expect(ends(atPkt(1, 30))).toBe(atPkt(13).toISOString());
  });
  test('off: plain clock time', () => {
    process.env[KEY] = 'off';
    expect(ends(atPkt(19))).toBe(next(1).toISOString());
  });
  test('a daytime window 13-15 is skipped too: 12:00 + 6 h ends 20:00', () => {
    process.env[KEY] = '13-15';
    expect(ends(atPkt(12))).toBe(atPkt(20).toISOString());
  });
  test('it agrees with nudgeTargetUtc: the end is never inside the window unless it lands on its first instant', () => {
    delete process.env[KEY];
    for (let h = 0; h < 24; h++) {
      const end = Nudge.quietAwareDeadlineUtc(atPkt(h, 20), SIX_H);
      const heldTo = Nudge.nudgeTargetUtc(end);
      const pktHour = new Date(end.getTime() + 5 * 3600 * 1000).getUTCHours();
      const onOpening = pktHour === 21 && end.getUTCMinutes() === 0;
      if (!onOpening) expect(heldTo.toISOString()).toBe(end.toISOString());
    }
  });
});
