'use strict';
/**
 * bd-b9e28 — the LP quiz cache's single-flight lock is keyed on the lesson and held under the quiz id.
 * When a worker dies mid-author, SQS redelivers the same quiz_generate job; the dead attempt's lock is
 * still set (TTL), under THIS quiz's own id. Before the fix acquire() answered 'held', so the job
 * waited on itself (re-queued up to maxCacheWaits, ~3 min) before authoring anyway.
 *
 * Mocked: Redis only — a tiny in-memory SET NX + the check-and-extend script.
 */
const mockLocks = new Map(); // full redis key ('lock:<resource>') -> holder id
const mockRedis = { available: true };
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => mockRedis.available,
  acquireLock: jest.fn(async (res, id) => {
    const k = `lock:${res}`;
    if (mockLocks.has(k)) return false;
    mockLocks.set(k, id);
    return true;
  }),
  releaseLock: jest.fn(async (res, id) => {
    const k = `lock:${res}`;
    if (mockLocks.get(k) !== id) return false;
    mockLocks.delete(k);
    return true;
  }),
  // The real evalScript runs Lua; here: "if GET key == ARGV[1] then EXPIRE, 1 else 0".
  evalScript: jest.fn(async (_script, keys, args) => (mockLocks.get(keys[0]) === String(args[0]) ? 1 : 0)),
}));

const Redis = require('../../bot/shared/services/cache/railway-redis.service');
const Cache = require('../../bot/shared/services/quiz/lp-quiz-cache');

const KEY = 'lp612:grade_6_cs_c01_p01:v3:en';

beforeEach(() => {
  mockLocks.clear();
  mockRedis.available = true;
  jest.clearAllMocks();
});

describe('acquire(): a lock this same quiz already holds', () => {
  test('a redelivered job whose own dead attempt still holds the lock gets it back', async () => {
    mockLocks.set(`lock:lpquizcache:${KEY}`, 'quiz-1'); // the dead attempt's lock, TTL not yet run out
    await expect(Cache.acquire(KEY, 'quiz-1')).resolves.toBe('acquired');
    // the lock is still this quiz's, so its release at the end frees it
    await Cache.release(KEY, 'quiz-1');
    expect(mockLocks.size).toBe(0);
  });

  test('the TTL is renewed for the new attempt (EXPIRE with the lock TTL)', async () => {
    mockLocks.set(`lock:lpquizcache:${KEY}`, 'quiz-1');
    await Cache.acquire(KEY, 'quiz-1');
    expect(Redis.evalScript).toHaveBeenCalledWith(
      expect.stringMatching(/expire/i), [`lock:lpquizcache:${KEY}`], ['quiz-1', expect.any(Number)],
    );
  });

  test('a lock another quiz holds is still held — the wait is unchanged', async () => {
    mockLocks.set(`lock:lpquizcache:${KEY}`, 'other-quiz');
    await expect(Cache.acquire(KEY, 'quiz-1')).resolves.toBe('held');
    expect(mockLocks.get(`lock:lpquizcache:${KEY}`)).toBe('other-quiz');
  });

  test('a free lock is acquired without the script', async () => {
    await expect(Cache.acquire(KEY, 'quiz-1')).resolves.toBe('acquired');
    expect(Redis.evalScript).not.toHaveBeenCalled();
  });

  test('the script failing (null) reads as held, never as acquired', async () => {
    mockLocks.set(`lock:lpquizcache:${KEY}`, 'quiz-1');
    Redis.evalScript.mockResolvedValueOnce(null);
    await expect(Cache.acquire(KEY, 'quiz-1')).resolves.toBe('held');
  });

  test('Redis down: unavailable, as before', async () => {
    mockRedis.available = false;
    await expect(Cache.acquire(KEY, 'quiz-1')).resolves.toBe('unavailable');
  });
});
