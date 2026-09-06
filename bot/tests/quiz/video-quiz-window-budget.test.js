'use strict';
/**
 * Red-first tests for the re-costed per-recipient
 * send window.
 *
 * Staging, 2026-09-06 11:18-11:24 UTC: one child on an 8-question transcript
 * quiz waited 174812/188065/201097/213090 ms per verdict from question 5 on.
 * Cause: MAX_SENDS_PER_WINDOW = 20 with a per-question cost of 4 sends
 * (chrome text, card image, buttons, verdict) — 8 x 4 = 32 > 20, so the
 * window filled at question 5 with no way out but waiting for the oldest
 * send to age out of the 5-minute window.
 *
 * A parallel change (not this file) collapses a question to 2 sends (one
 * message carrying the question, one carrying the verdict). This file proves
 * the resulting real per-recipient budget for one child's fastest possible
 * 8-question run —
 *   1 (vqHereWeGo opener) + 8*2 (questions) + 1 (scorecard) + 1 (the
 *   video_solo/share_link finish() offer) = 19
 * — fits inside the raised cap (24) with zero waiting, and that the cap
 * itself is still a real cap (not simply removed).
 *
 * RUN: NODE_OPTIONS='--localstorage-file=/tmp/jest-ls.json' npx jest tests/quiz/video-quiz-window-budget.test.js
 */

const mockStore = new Map();
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null)),
  set: jest.fn(async (key, value) => {
    mockStore.set(key, value);
    return true;
  }),
}));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const loggedEvents = [];
jest.mock('../../shared/utils/structured-logger', () => ({
  logEvent: jest.fn((eventName, data) => { loggedEvents.push({ eventName, data }); }),
}));

const rateLimiter = require('../../shared/services/quiz/video-quiz-rate-limiter.service');
const { logEvent } = require('../../shared/utils/structured-logger');

beforeEach(() => {
  mockStore.clear();
  loggedEvents.length = 0;
  jest.useFakeTimers();
  // The process-wide outbound bucket does not refill under fake time; each
  // test starts with a full one so only the per-recipient window is under
  // test here — same reasoning as video-quiz-rate-limiter.test.js.
  rateLimiter.resetGlobalBucket();
  logEvent.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * Resolve whether `promise` has settled without advancing fake time past
 * "now" — throttle() awaits the mocked redis get/set (each a real microtask
 * hop), so advanceTimersByTimeAsync(0) is what actually flushes that chain.
 * Same helper as video-quiz-rate-limiter.test.js.
 */
async function settledWithoutAdvancing(promise) {
  let resolved = false;
  promise.then(() => {
    resolved = true;
  });
  await jest.advanceTimersByTimeAsync(0);
  return resolved;
}

describe('the re-costed session budget fits with zero waiting', () => {
  test('a fresh window absorbs a full session (19 sends) with zero waiting, and the cap still bites at the 25th send', async () => {
    const phone = '923001112222';
    const SESSION_SENDS = 1 + 8 * 2 + 1 + 1; // opener + 8 questions*2 + scorecard + finish offer
    expect(SESSION_SENDS).toBe(19);

    // The re-costed cap itself — pinned to a literal so this fails loudly
    // (rather than trivially passing against whatever the constant happens
    // to be) if MAX_SENDS_PER_WINDOW is not actually raised to 24.
    const NEW_CAP = 24;
    expect(rateLimiter.MAX_SENDS_PER_WINDOW).toBe(NEW_CAP);

    // The real session's worth of sends: every one of the 19 resolves
    // immediately — nobody waits mid-quiz.
    for (let i = 0; i < SESSION_SENDS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const resolved = await settledWithoutAdvancing(rateLimiter.throttle(phone));
      expect(resolved).toBe(true);
    }
    expect(logEvent).not.toHaveBeenCalled();

    // The raised cap leaves real headroom above the 19-send budget — prove
    // the next 5 calls (20th-24th) are ALSO instant. On develop
    // (MAX_SENDS_PER_WINDOW = 20) this fails at the 21st call: the window
    // fills at 20 and everything after that waits for the full WINDOW_MS.
    for (let i = SESSION_SENDS; i < NEW_CAP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const resolved = await settledWithoutAdvancing(rateLimiter.throttle(phone));
      expect(resolved).toBe(true);
    }

    // The 25th consecutive send DOES wait — the cap is real, not removed.
    const pending = rateLimiter.throttle(phone);
    expect(await settledWithoutAdvancing(pending)).toBe(false);

    await jest.advanceTimersByTimeAsync(rateLimiter.WINDOW_MS);
    expect(await settledWithoutAdvancing(pending)).toBe(true);
  });
});

describe('video_quiz.throttle_wait', () => {
  test('a call that never waits emits nothing', async () => {
    const phone = '923011110001';
    await rateLimiter.throttle(phone);
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('a call that waits past the log threshold emits exactly one video_quiz.throttle_wait, with only the last-4 phone digits', async () => {
    const phone = '923011119999';
    for (let i = 0; i < rateLimiter.MAX_SENDS_PER_WINDOW; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await rateLimiter.throttle(phone);
    }
    logEvent.mockClear();
    loggedEvents.length = 0;

    const pending = rateLimiter.throttle(phone);
    // The window is full and freshly recorded, so the wait runs the full
    // WINDOW_MS (5 min) in MAX_SLEEP_ITERATION_MS (2s) hops — comfortably
    // past the 5000ms log threshold, matching the 174s-213s waits observed
    // on staging.
    await jest.advanceTimersByTimeAsync(rateLimiter.WINDOW_MS);
    await pending;

    const events = loggedEvents.filter((e) => e.eventName === 'video_quiz.throttle_wait');
    expect(events).toHaveLength(1);
    const { data } = events[0];
    expect(data.ms).toBeGreaterThanOrEqual(5000);
    expect(data.phoneTail).toBe('9999');
    expect(String(data.phoneTail)).not.toContain(phone);
    expect(data.maxPerWindow).toBe(rateLimiter.MAX_SENDS_PER_WINDOW);
    expect(typeof data.windowCount).toBe('number');
    expect(typeof data.iterations).toBe('number');
    expect(data.iterations).toBeGreaterThan(0);
  });
});
