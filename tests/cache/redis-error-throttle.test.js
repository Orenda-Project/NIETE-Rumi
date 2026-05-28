/**
 * §D-2 guard — Railway Redis 'error' event handler must throttle to ≤1 log per 10s.
 *
 * ioredis fires 'error' on every reconnect attempt (every ~0.7s during a real
 * outage). Without throttling the log file fills with hundreds of identical
 * lines that drown out everything else. This guard fires 50 events in <1s and
 * asserts logToFile was called exactly once.
 *
 * The service exports a SINGLETON (`module.exports = new RailwayRedisService()`),
 * so each test does its own resetModules() + doMock() + require() to start fresh.
 */

const path = require('path');
const SERVICE = path.resolve(__dirname, '../../bot/shared/services/cache/railway-redis.service');
const LOGGER = path.resolve(__dirname, '../../bot/shared/utils/logger');
const CONSTANTS = path.resolve(__dirname, '../../bot/shared/utils/constants');

function loadFreshService() {
  jest.resetModules();
  jest.doMock('ioredis', () => {
    return class MockRedis {
      constructor() { this.handlers = {}; this.status = 'connecting'; }
      on(event, fn) { this.handlers[event] = fn; }
      fire(event, payload) { if (this.handlers[event]) this.handlers[event](payload); }
    };
  });
  const mockLog = jest.fn();
  jest.doMock(LOGGER, () => ({ logToFile: mockLog }));
  jest.doMock(CONSTANTS, () => ({ RATE_LIMIT_MAX: 30, RATE_LIMIT_WINDOW_SECONDS: 60 }));
  process.env.REDIS_URL = 'redis://localhost:6379';
  const svc = require(SERVICE);
  return { svc, mockLog };
}

describe('railway-redis error spam throttle', () => {
  it('logs at most once when 50 error events fire in <1s', () => {
    const { svc, mockLog } = loadFreshService();
    for (let i = 0; i < 50; i++) {
      svc.redis.fire('error', { message: 'ECONNREFUSED', code: 'ECONNREFUSED' });
    }
    const errorLogCalls = mockLog.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('Railway Redis error')
    );
    expect(errorLogCalls).toHaveLength(1);
  });

  it('handles empty error.message gracefully (prints code or fallback)', () => {
    const { svc, mockLog } = loadFreshService();
    svc.redis.fire('error', { message: '', code: 'ENOTFOUND' });
    const errorLogCalls = mockLog.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('Railway Redis error')
    );
    expect(errorLogCalls).toHaveLength(1);
    const [, payload] = errorLogCalls[0];
    expect(payload.error || payload.code).toBeTruthy();
  });
});
