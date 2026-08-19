/**
 * bd-ecpo5 — redisService.setNX MUST exist (it was called but undefined, so Phase 3
 * classroom-photo capture threw and every photo fell through to pic-to-LP: 0 of 864
 * sessions ever captured a photo). setNX = atomic set-if-not-exists with TTL.
 */
const path = require('path');
const SERVICE = path.resolve(__dirname, '../../bot/shared/services/cache/railway-redis.service');
const LOGGER = path.resolve(__dirname, '../../bot/shared/utils/logger');
const CONSTANTS = path.resolve(__dirname, '../../bot/shared/utils/constants');

function load() {
  jest.resetModules();
  jest.doMock('ioredis', () => class MockRedis {
    constructor() { this.handlers = {}; this.status = 'ready'; }
    on(event, fn) { this.handlers[event] = fn; }
  });
  jest.doMock(LOGGER, () => ({ logToFile: jest.fn() }));
  jest.doMock(CONSTANTS, () => ({ RATE_LIMIT_MAX: 30, RATE_LIMIT_WINDOW_SECONDS: 60 }));
  process.env.REDIS_URL = 'redis://localhost:6379';
  return require(SERVICE);
}

afterEach(() => { jest.resetModules(); });

describe('bd-ecpo5 — RailwayRedisService.setNX', () => {
  it('exists as a function (the whole bug: it did not)', () => {
    const svc = load();
    expect(typeof svc.setNX).toBe('function');
  });

  it('claims a new key → returns true, issues SET … EX ttl NX', async () => {
    const svc = load();
    svc.redis.set = jest.fn().mockResolvedValue('OK');
    const r = await svc.setNX('k', { a: 1 }, 3600);
    expect(r).toBe(true);
    expect(svc.redis.set).toHaveBeenCalledWith('k', JSON.stringify({ a: 1 }), 'EX', 3600, 'NX');
  });

  it('returns false when the key already exists (SET NX → null)', async () => {
    const svc = load();
    svc.redis.set = jest.fn().mockResolvedValue(null);
    expect(await svc.setNX('k', 'v', 3600)).toBe(false);
  });

  it('omits EX when no ttl given', async () => {
    const svc = load();
    svc.redis.set = jest.fn().mockResolvedValue('OK');
    await svc.setNX('k', 'v');
    expect(svc.redis.set).toHaveBeenCalledWith('k', 'v', 'NX');
  });

  it('Redis unavailable → returns true (proceed, never drop the work)', async () => {
    const svc = load();
    svc.redis.status = 'connecting'; // isAvailable() → false
    svc.redis.set = jest.fn();
    const r = await svc.setNX('k', 'v', 60);
    expect(r).toBe(true);
    expect(svc.redis.set).not.toHaveBeenCalled();
  });

  it('set() throwing → returns true (do not block capture on a de-dup failure)', async () => {
    const svc = load();
    svc.redis.set = jest.fn().mockRejectedValue(new Error('boom'));
    expect(await svc.setNX('k', 'v', 60)).toBe(true);
  });
});
