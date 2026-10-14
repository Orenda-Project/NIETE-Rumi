'use strict';
/**
 * The hourly lesson-plan health check — from lesson_plan_requests itself, one summary per tick.
 *
 * WHY. NIETE had no lesson-plan health signal at all (no /health/lesson-plans, no feature-health
 * port). Once the lifecycle is switched on, every path writes its asks to one table, so one bounded
 * read an hour can say, per path and channel: how many asks, how many delivered, how many failed and
 * why, how long they took — and whether anything is stuck.
 *
 * RULES PINNED.
 *   · A no-op (no database or cache call) until LP_LIFECYCLE_PATHS switches a path on.
 *   · Exactly one replica reads per tick: a read-back claim in Redis; a cache that cannot answer is a
 *     skip, never a double report.
 *   · NO_ASSET / NOT_ELIGIBLE are content answers (the plan is not there, or not for her) — reported,
 *     never counted against health. GENERATION / RENDER / DELIVERY / QUEUE failures are ours.
 *   · degraded = anything stuck > 6 h, or a path/channel failing >= 20% of >= 10 finished asks; it is
 *     said at error level as well as in the event.
 *   · Never throws.
 */

const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
const mockEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockEvent(...a), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
let mockCalls = 0;
let mockFailReads = false;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => {
    mockCalls += 1;
    if (mockFailReads) {
      const err = { data: null, error: { code: '57014', message: 'statement timeout' }, count: null };
      const b = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => Promise.resolve(err).then(res) : () => b) });
      return b;
    }
    return mockDb.from(t);
  },
}));

const Health = require('../../bot/shared/services/monitoring/lesson-plan-health.service');

const NOW = new Date('2026-10-14T10:00:00.000Z');
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
let seq = 0;
const ask = (over = {}) => ({
  id: `r-${(seq += 1)}`, user_id: 'u', phone_number: '92300', topic: 't', source: 'niete_v8_segment', channel: 'whatsapp',
  status: 'completed', error_code: null, created_at: ago(30), delivered_at: ago(29), ...over,
});

function fakeRedis({ available = true, holder = null } = {}) {
  const store = new Map();
  return {
    store,
    isAvailable: () => available,
    setNX: jest.fn(async (k, v) => { if (holder) store.set(k, holder); else if (!store.has(k)) store.set(k, v); return true; }),
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
  };
}
const checked = () => mockEvent.mock.calls.filter((c) => c[0] === 'lesson_plan.health.checked').map((c) => c[1]);
const errorLogs = () => mockLog.mock.calls.filter((c) => c[2] === 'error');

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  process.env.REGION = 'niete';
  mockLog.mockClear();
  mockEvent.mockClear();
  mockCalls = 0;
  mockFailReads = false;
  mockDb = createMemorySupabase({ lesson_plan_requests: [] });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('switched off', () => {
  test('no path on: nothing is read, nothing is claimed, nothing is said', async () => {
    const redis = fakeRedis();
    await expect(Health.run({ now: NOW, redis })).resolves.toEqual({ outcome: 'off' });
    expect(mockCalls).toBe(0);
    expect(redis.setNX).not.toHaveBeenCalled();
    expect(checked()).toHaveLength(0);
  });
});

describe('switched on', () => {
  beforeEach(() => { process.env.LP_LIFECYCLE_PATHS = 'all'; });

  test('a healthy hour: one summary per path and channel; content answers are reported, not counted', async () => {
    mockDb.tables.lesson_plan_requests = [
      ask({ created_at: ago(40), delivered_at: ago(39.5) }), // 30 s
      ask({ created_at: ago(30), delivered_at: ago(29) }), // 60 s
      ask({ created_at: ago(20), delivered_at: ago(18.5) }), // 90 s
      ask({ status: 'failed', error_code: 'NO_ASSET', delivered_at: null }),
      ask({ source: 'niete_lp612', channel: 'portal' }),
      ask({ created_at: ago(120) }), // outside the hour
      ask({ source: null, channel: null }), // a row from before the lifecycle: not a path's
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out).toEqual(expect.objectContaining({ outcome: 'checked', verdict: 'healthy', reasons: [], stuck: 0 }));
    const [event] = checked();
    expect(event).toEqual(expect.objectContaining({ windowMin: 60, verdict: 'healthy', stuck: 0, rowsRead: 5 }));
    const v8 = event.sources.find((s) => s.source === 'niete_v8_segment' && s.channel === 'whatsapp');
    expect(v8).toEqual(expect.objectContaining({
      asks: 4, delivered: 3, inFlight: 0, failed: 1, systemFailures: 0, systemFailureRate: 0,
      codes: { NO_ASSET: 1 }, p50DeliverSec: 60, p90DeliverSec: 90,
    }));
    expect(event.sources.find((s) => s.channel === 'portal')).toEqual(expect.objectContaining({ source: 'niete_lp612', asks: 1, delivered: 1 }));
    expect(errorLogs()).toHaveLength(0);
  });

  test('a path failing >= 20% of >= 10 finished asks is DEGRADED, and said at error level', async () => {
    mockDb.tables.lesson_plan_requests = [
      ...Array.from({ length: 7 }, () => ask({ source: 'niete_lp612' })),
      ...Array.from({ length: 3 }, () => ask({ source: 'niete_lp612', status: 'failed', error_code: 'DELIVERY_FAILED', delivered_at: null })),
      // a small path failing hard is noise, not a verdict (2 of 3)
      ...Array.from({ length: 2 }, () => ask({ source: 'homework_bundle', status: 'failed', error_code: 'GENERATION_FAILED', delivered_at: null })),
      ask({ source: 'homework_bundle' }),
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out).toEqual(expect.objectContaining({ verdict: 'degraded', reasons: ['failure_rate:niete_lp612/whatsapp'] }));
    expect(checked()[0].sources.find((s) => s.source === 'niete_lp612')).toEqual(expect.objectContaining({ systemFailures: 3, systemFailureRate: 0.3 }));
    expect(errorLogs()).toHaveLength(1);
  });

  test('a request stuck pending or processing for more than 6 hours is DEGRADED', async () => {
    mockDb.tables.lesson_plan_requests = [
      ask({ source: 'niete_grounded', status: 'pending', delivered_at: null, created_at: ago(7 * 60) }),
      ask({ source: 'niete_grounded', status: 'processing', delivered_at: null, created_at: ago(5) }), // in flight, not stuck
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out).toEqual(expect.objectContaining({ verdict: 'degraded', reasons: ['stuck'], stuck: 1 }));
    expect(checked()[0].sources.find((s) => s.source === 'niete_grounded')).toEqual(expect.objectContaining({ asks: 1, inFlight: 1 }));
  });

  test('another replica holds this tick: no read, no report', async () => {
    const out = await Health.run({ now: NOW, redis: fakeRedis({ holder: 'tick:someone-else' }) });
    expect(out).toEqual({ outcome: 'skipped', reason: 'other' });
    expect(mockCalls).toBe(0);
    expect(checked()).toHaveLength(0);
  });

  test('a cache that cannot answer is a skip — never a report from every replica', async () => {
    await expect(Health.run({ now: NOW, redis: fakeRedis({ available: false }) })).resolves.toEqual({ outcome: 'skipped', reason: 'unavailable' });
    expect(mockCalls).toBe(0);
  });

  test('a read that fails is said at error level and resolves — it never reaches the worker', async () => {
    mockFailReads = true;
    await expect(Health.run({ now: NOW, redis: fakeRedis() })).resolves.toEqual(expect.objectContaining({ outcome: 'read_failed' }));
    expect(errorLogs()).toHaveLength(1);
    expect(checked()).toHaveLength(0);
  });
});
