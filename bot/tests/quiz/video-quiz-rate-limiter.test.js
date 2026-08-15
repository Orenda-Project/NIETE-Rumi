'use strict';
/**
 * bd-2666 — TDD red-first tests for the per-recipient sliding-window
 * self-throttle that sits in front of every video-quiz WhatsApp send.
 *
 * Root cause this defends against: video-quiz-sender.service.js paces sends
 * only for WhatsApp message ORDERING (GAP_TEXT_MS/GAP_MEDIA_MS =
 * 700ms/1200ms) — never for Meta's per-(business,consumer)-pair rate limit.
 * That trips error 131056 ("(Business Account, Consumer Account) pair rate
 * limit hit"). bd-2477's reactive 3-strike backoff recovers gracefully AFTER
 * the limit is hit; this module is the PROACTIVE half — wait until there is
 * room in a rolling per-phone window BEFORE sending.
 *
 * Written before shared/services/quiz/video-quiz-rate-limiter.service.js
 * exists, so this file is expected to fail (module not found) until the
 * service is implemented.
 *
 * RUN: NODE_OPTIONS='--localstorage-file=/tmp/jest-ls.json' npx jest tests/quiz/video-quiz-rate-limiter.test.js
 */

// Stand-in for railway-redis.service.js's actual contract
// (redisService.set(key, obj, ttlSeconds) / redisService.get(key) — a JSON-KV
// wrapper with TTL, not raw ZSET primitives). Pure in-memory Map so this is a
// deterministic unit test of the sliding-window math, no real Redis involved.
const mockStore = new Map();
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null)),
  set: jest.fn(async (key, value) => {
    mockStore.set(key, value);
    return true;
  }),
}));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const rateLimiter = require('../../shared/services/quiz/video-quiz-rate-limiter.service');
const { logToFile } = require('../../shared/utils/logger');

beforeEach(() => {
  mockStore.clear();
  jest.useFakeTimers();
  logToFile.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * Resolve a boolean telling us whether `promise` has settled, without
 * advancing fake time past "now". throttle() awaits the mocked redis
 * get/set (each a real microtask hop), so a couple of Promise.resolve()
 * ticks is not reliably enough to drain that chain — advanceTimersByTimeAsync(0)
 * is jest's own idiom for flushing pending microtasks/0ms-timers.
 */
async function settledWithoutAdvancing(promise) {
  let resolved = false;
  promise.then(() => {
    resolved = true;
  });
  await jest.advanceTimersByTimeAsync(0);
  return resolved;
}

describe('bd-2666 — video-quiz-rate-limiter sliding window', () => {
  test('the first MAX_SENDS_PER_WINDOW calls for a phone resolve immediately, no wait', async () => {
    const phone = '923001112222';
    for (let i = 0; i < rateLimiter.MAX_SENDS_PER_WINDOW; i += 1) {
      const resolved = await settledWithoutAdvancing(rateLimiter.throttle(phone));
      expect(resolved).toBe(true);
    }
  });

  test('the call after the budget is exhausted WAITS for the window to elapse', async () => {
    const phone = '923003334444';
    for (let i = 0; i < rateLimiter.MAX_SENDS_PER_WINDOW; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await rateLimiter.throttle(phone);
    }

    const pending = rateLimiter.throttle(phone);
    expect(await settledWithoutAdvancing(pending)).toBe(false);

    // Well before the window elapses — still waiting.
    await jest.advanceTimersByTimeAsync(rateLimiter.WINDOW_MS - 5000);
    expect(await settledWithoutAdvancing(pending)).toBe(false);

    // Past the window — the oldest send has aged out, budget frees up.
    await jest.advanceTimersByTimeAsync(10000);
    expect(await settledWithoutAdvancing(pending)).toBe(true);
  });

  test('after the window fully elapses, a fresh call for the same phone resolves promptly again', async () => {
    const phone = '923005556666';
    for (let i = 0; i < rateLimiter.MAX_SENDS_PER_WINDOW; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await rateLimiter.throttle(phone);
    }

    await jest.advanceTimersByTimeAsync(rateLimiter.WINDOW_MS + 1000);

    const resolved = await settledWithoutAdvancing(rateLimiter.throttle(phone));
    expect(resolved).toBe(true);
  });

  test('two different phones do not share a budget', async () => {
    const phoneA = '923007778888';
    const phoneB = '923009990000';
    for (let i = 0; i < rateLimiter.MAX_SENDS_PER_WINDOW; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await rateLimiter.throttle(phoneA);
    }

    // phoneA is exhausted...
    expect(await settledWithoutAdvancing(rateLimiter.throttle(phoneA))).toBe(false);
    // ...but phoneB has never sent anything, so it must resolve immediately.
    expect(await settledWithoutAdvancing(rateLimiter.throttle(phoneB))).toBe(true);
  });

  test('a caller that waits does not block a single giant sleep — it re-checks periodically', async () => {
    // Each sleep iteration is capped (MAX_SLEEP_ITERATION_MS), so a waiting
    // call must re-evaluate more than once on its way to the full WINDOW_MS.
    const phone = '923001231234';
    for (let i = 0; i < rateLimiter.MAX_SENDS_PER_WINDOW; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await rateLimiter.throttle(phone);
    }

    const pending = rateLimiter.throttle(phone);
    // Advancing by exactly one capped iteration must NOT be enough to resolve
    // (proves it isn't a single wait for the whole window).
    await jest.advanceTimersByTimeAsync(rateLimiter.MAX_SLEEP_ITERATION_MS);
    expect(await settledWithoutAdvancing(pending)).toBe(false);

    await jest.advanceTimersByTimeAsync(rateLimiter.WINDOW_MS);
    expect(await settledWithoutAdvancing(pending)).toBe(true);
  });
});

// bd-2681 — this module previously emitted zero telemetry, so "is the
// throttle actually engaging, and for how long" could only be reconstructed
// indirectly by correlating separate failure logs against DB timestamps.
describe('bd-2681 — the throttle logs when it actually has to wait', () => {
  test('does NOT log anything for a call that resolves immediately (no wait)', async () => {
    const phone = '923011112222';
    await rateLimiter.throttle(phone);
    expect(logToFile).not.toHaveBeenCalled();
  });

  test('logs the wait decision, with the phone (last-4 only) and window size, when the budget is full', async () => {
    const phone = '923011112223';
    for (let i = 0; i < rateLimiter.MAX_SENDS_PER_WINDOW; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await rateLimiter.throttle(phone);
    }
    logToFile.mockClear();

    const pending = rateLimiter.throttle(phone);
    await jest.advanceTimersByTimeAsync(0);

    expect(logToFile).toHaveBeenCalled();
    const [msg, meta] = logToFile.mock.calls[0];
    expect(msg).toMatch(/rate-limiter/i);
    expect(msg).toMatch(/wait/i);
    expect(meta.phone).toBe('2223'); // last 4 digits, never the full number
    expect(meta.windowSize).toBe(rateLimiter.MAX_SENDS_PER_WINDOW);
    expect(meta.maxPerWindow).toBe(rateLimiter.MAX_SENDS_PER_WINDOW);

    await jest.advanceTimersByTimeAsync(rateLimiter.WINDOW_MS);
    await pending;
  });
});
