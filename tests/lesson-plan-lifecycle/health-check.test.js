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
 *   · degraded too = a QUIET path that has stopped delivering: its last 3 attempts failed with nothing
 *     delivered in between, over the last day. The window rules cannot see it — on the 2026-10-14 sandbox
 *     run a curriculum ask failed all three attempts and the hour read "asks 2, failed 1, rate 0.5:
 *     healthy" — and in production that path is rare enough that a total outage would never trip them.
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
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    del: (k) => store.delete(k),
  };
}
const checked = () => mockEvent.mock.calls.filter((c) => c[0] === 'lesson_plan.health.checked').map((c) => c[1]);
const errorLogs = () => mockLog.mock.calls.filter((c) => c[2] === 'error');

// The alert's Slack target and the write-failure count's Axiom token: unset here, so this suite never
// reaches the network (the alert itself is pinned in health-alert.test.js).
const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION', 'LP_HEALTH_ALERT', 'AXIOM_TOKEN', 'AXIOM_API_TOKEN',
  'QUIZ_FUNNEL_WATCH_SLACK_TOKEN', 'QUIZ_FUNNEL_WATCH_SLACK_CHANNEL', 'PROD_DIGEST_SLACK_TOKEN', 'PROD_DIGEST_SLACK_CHANNEL'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.REGION = 'niete';
  mockLog.mockClear();
  mockEvent.mockClear();
  mockCalls = 0;
  mockFailReads = false;
  mockDb = createMemorySupabase({ lesson_plan_requests: [] });
  Health.__resetForTests();
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
      ask({ source: 'niete_grounded', status: 'processing', delivered_at: null, created_at: ago(20) }), // in flight, not stuck
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out).toEqual(expect.objectContaining({ verdict: 'degraded', reasons: ['stuck'], stuck: 1 }));
    expect(checked()[0].sources.find((s) => s.source === 'niete_grounded')).toEqual(expect.objectContaining({ asks: 1, inFlight: 1 }));
  });

  test('a stuck request is reported ONCE — in the window it crosses six hours, not every hour after', async () => {
    mockDb.tables.lesson_plan_requests = [
      ask({ source: 'homework_bundle', status: 'pending', delivered_at: null, created_at: ago(6 * 60 + 30) }), // crossed in this window
      ask({ source: 'homework_bundle', status: 'pending', delivered_at: null, created_at: ago(30 * 60) }), // crossed long ago
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out).toEqual(expect.objectContaining({ stuck: 1, reasons: ['stuck'] }));
  });

  test('a failure code on a request still in flight is not counted against the rate', async () => {
    mockDb.tables.lesson_plan_requests = [
      ...Array.from({ length: 10 }, () => ask({ source: 'niete_grounded' })),
      // a retry in progress still carries the code of its last attempt
      ...Array.from({ length: 4 }, () => ask({ source: 'niete_grounded', status: 'processing', error_code: 'RENDER_FAILED', delivered_at: null })),
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.sources[0]).toEqual(expect.objectContaining({ inFlight: 4, systemFailures: 0, systemFailureRate: 0 }));
    expect(out.verdict).toBe('healthy');
  });

  test('five system failures in the window are DEGRADED even below ten finished asks', async () => {
    mockDb.tables.lesson_plan_requests = [
      ...Array.from({ length: 5 }, () => ask({ source: 'niete_oxbridge', status: 'failed', error_code: 'RENDER_FAILED', delivered_at: null })),
      ask({ source: 'niete_oxbridge' }),
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out).toEqual(expect.objectContaining({ verdict: 'degraded', reasons: ['failure_rate:niete_oxbridge/whatsapp'] }));
  });

  test('each tick reads from where the last one stopped — no overlap, no gap — 15 minutes behind, so outcomes have landed', async () => {
    const redis = fakeRedis();
    mockDb.tables.lesson_plan_requests = [
      ask({ created_at: ago(20), delivered_at: ago(19) }), // in the first window
      ask({ created_at: ago(10), delivered_at: ago(9) }), // too recent for the first; in the second
    ];
    const first = await Health.run({ now: NOW, redis });
    expect(first.sources[0].asks).toBe(1);
    redis.store.delete('lp_health:tick'); // the next hour's claim
    const later = new Date(NOW.getTime() + 60 * 60_000);
    const second = await Health.run({ now: later, redis });
    expect(second.sources[0].asks).toBe(1);
    expect(checked()[1]).toEqual(expect.objectContaining({ windowStart: ago(15) }));
  });

  test('a cache that cannot answer warns each time, and pages at error level on the third tick in a row', async () => {
    const redis = fakeRedis({ available: false });
    await Health.run({ now: NOW, redis });
    await Health.run({ now: NOW, redis });
    expect(errorLogs()).toHaveLength(0);
    await Health.run({ now: NOW, redis });
    expect(errorLogs()).toHaveLength(1);
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

  test('a read that hit the row cap is DEGRADED (truncated) — a flood can never hide failures behind "healthy"', async () => {
    // PostgREST answers at most 1,000 rows (db-max-rows): a full page means the read did not see everything.
    mockDb.tables.lesson_plan_requests = Array.from({ length: 1000 }, () => ask());
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out).toEqual(expect.objectContaining({ outcome: 'checked', verdict: 'degraded', reasons: expect.arrayContaining(['truncated']) }));
    expect(checked()[0]).toEqual(expect.objectContaining({ truncated: true, verdict: 'degraded' }));
    expect(errorLogs()).toHaveLength(1);
  });

  test('a read that fails is said at error level and resolves — it never reaches the worker', async () => {
    mockFailReads = true;
    await expect(Health.run({ now: NOW, redis: fakeRedis() })).resolves.toEqual(expect.objectContaining({ outcome: 'read_failed' }));
    expect(errorLogs()).toHaveLength(1);
    expect(checked()).toHaveLength(0);
  });
});

describe('the watermark', () => {
  beforeEach(() => { process.env.LP_LIFECYCLE_PATHS = 'all'; });

  test('a watermark that cannot be read is said at warn level, and the tick still summarises the last hour', async () => {
    const redis = fakeRedis();
    const realGet = redis.get;
    redis.get = jest.fn(async (k) => {
      if (k === 'lp_health:watermark') throw new Error('READONLY replica');
      return realGet(k);
    });
    mockDb.tables.lesson_plan_requests = [ask({ created_at: ago(30), delivered_at: ago(29) })];
    const out = await Health.run({ now: NOW, redis });
    expect(out).toEqual(expect.objectContaining({ outcome: 'checked' }));
    expect(checked()[0]).toEqual(expect.objectContaining({ windowStart: ago(75), windowMin: 60 }));
    expect(mockLog).toHaveBeenCalledWith(expect.stringMatching(/watermark/i), expect.objectContaining({ error: 'READONLY replica' }), 'warn');
  });
});

describe('the kill switch reads only what it knows', () => {
  test('an LP_HEALTH_CHECK value that is neither off nor on is said once at warn level, and the check keeps running', () => {
    expect(Health.healthCheckOff({ LP_HEALTH_CHECK: 'disabled' })).toBe(false);
    expect(Health.healthCheckOff({ LP_HEALTH_CHECK: 'disabled' })).toBe(false);
    const warns = mockLog.mock.calls.filter((c) => c[2] === 'warn' && /LP_HEALTH_CHECK/.test(String(c[0])));
    expect(warns).toHaveLength(1);
  });

  test('off words stop it and on words or empty run it, all in silence', () => {
    for (const v of ['off', 'false', '0', 'no']) expect(Health.healthCheckOff({ LP_HEALTH_CHECK: v })).toBe(true);
    for (const v of ['', 'on', 'true', '1', 'yes']) expect(Health.healthCheckOff({ LP_HEALTH_CHECK: v })).toBe(false);
    expect(mockLog.mock.calls.filter((c) => /LP_HEALTH_CHECK/.test(String(c[0])))).toHaveLength(0);
  });
});

describe('what counts as finished, and what the cache says', () => {
  beforeEach(() => { process.env.LP_LIFECYCLE_PATHS = 'all'; });

  test('a curriculum ask whose job never reached the queue (pending + QUEUE_FAILED) is a finished SYSTEM failure, not in flight', async () => {
    mockDb.tables.lesson_plan_requests = Array.from({ length: 5 }, () => ask({
      source: 'niete_grounded', status: 'pending', error_code: 'QUEUE_FAILED', delivered_at: null,
    }));
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.sources[0]).toEqual(expect.objectContaining({ inFlight: 0, systemFailures: 5 }));
    expect(out).toEqual(expect.objectContaining({ verdict: 'degraded', reasons: ['failure_rate:niete_grounded/whatsapp'] }));
  });

  test('a curriculum render that failed with retries left is in flight (the queue retries it); the final failure counts', async () => {
    mockDb.tables.lesson_plan_requests = [
      ...Array.from({ length: 5 }, () => ask({ source: 'niete_grounded', status: 'failed', error_code: 'RENDER_FAILED', delivered_at: null, retry_count: 1 })),
    ];
    const retrying = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(retrying.sources[0]).toEqual(expect.objectContaining({ inFlight: 5, systemFailures: 0 }));
    expect(retrying.verdict).toBe('healthy');
    mockDb.tables.lesson_plan_requests.forEach((r) => { r.retry_count = 3; });
    const final = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(final.sources[0]).toEqual(expect.objectContaining({ inFlight: 0, systemFailures: 5 }));
    expect(final.verdict).toBe('degraded');
  });

  test('a watermark the cache would not store is said at warn level — the next tick re-reads that window', async () => {
    const redis = fakeRedis();
    redis.set = jest.fn(async () => false); // the real wrapper answers false, it never throws
    mockDb.tables.lesson_plan_requests = [ask()];
    await Health.run({ now: NOW, redis });
    expect(mockLog).toHaveBeenCalledWith(expect.stringMatching(/watermark/i), expect.anything(), 'warn');
  });

  test('a tick another replica holds breaks a run of skips — only consecutive cache failures page', async () => {
    const down = fakeRedis({ available: false });
    await Health.run({ now: NOW, redis: down });
    await Health.run({ now: NOW, redis: down });
    await Health.run({ now: NOW, redis: fakeRedis({ holder: 'tick:someone-else' }) });
    await Health.run({ now: NOW, redis: down });
    expect(errorLogs()).toHaveLength(0);
  });

  test('a tick within five minutes of the last reads nothing (too soon)', async () => {
    const redis = fakeRedis();
    redis.store.set('lp_health:watermark', ago(17)); // the lag is 15 min, so the window would be 2 min
    const out = await Health.run({ now: NOW, redis });
    expect(out).toEqual({ outcome: 'skipped', reason: 'too_soon' });
    expect(mockCalls).toBe(0);
  });

  test('none switches the check off, like the lifecycle switch', () => {
    expect(Health.healthCheckOff({ LP_HEALTH_CHECK: 'none' })).toBe(true);
  });
});

describe('a quiet path that has stopped delivering — its last attempts, over the last day', () => {
  beforeEach(() => { process.env.LP_LIFECYCLE_PATHS = 'all'; });
  const failedAsk = (over) => ask({ status: 'failed', delivered_at: null, ...over });

  test('the 14 Oct sandbox shape is NOT healthy: one cached serve, then a curriculum ask that failed all three attempts', async () => {
    mockDb.tables.lesson_plan_requests = [
      ask({ source: 'niete_grounded', created_at: ago(50), delivered_at: ago(49.9) }), // the cached serve
      failedAsk({ source: 'niete_grounded', error_code: 'RENDER_FAILED', retry_count: 3, created_at: ago(40) }),
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    // exactly what the health view read that day — under both window thresholds
    expect(out.sources).toEqual([expect.objectContaining({ asks: 2, failed: 1, systemFailures: 1, systemFailureRate: 0.5 })]);
    expect(out).toEqual(expect.objectContaining({ verdict: 'degraded', reasons: ['down:niete_grounded/whatsapp'] }));
    expect(checked()[0].down).toEqual([expect.objectContaining({
      source: 'niete_grounded', channel: 'whatsapp', attempts: 3, code: 'RENDER_FAILED', latestAt: ago(40),
    })]);
    expect(errorLogs()).toHaveLength(1);
  });

  test('three failed asks in a row, hours apart, are DOWN — no hourly window ever sees them together', async () => {
    mockDb.tables.lesson_plan_requests = [
      ask({ source: 'niete_portal_share', created_at: ago(20 * 60), delivered_at: ago(20 * 60 - 1) }),
      failedAsk({ source: 'niete_portal_share', error_code: 'DELIVERY_FAILED', created_at: ago(9 * 60) }),
      failedAsk({ source: 'niete_portal_share', error_code: 'DELIVERY_FAILED', created_at: ago(4 * 60) }),
      failedAsk({ source: 'niete_portal_share', error_code: 'DELIVERY_FAILED', created_at: ago(30) }),
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.sources).toEqual([expect.objectContaining({ asks: 1, systemFailures: 1 })]); // the window saw one
    expect(out.reasons).toEqual(['down:niete_portal_share/whatsapp']);
  });

  test('a delivery breaks the run: two failures since the last delivery are not a verdict', async () => {
    mockDb.tables.lesson_plan_requests = [
      failedAsk({ source: 'niete_portal_share', error_code: 'DELIVERY_FAILED', created_at: ago(9 * 60) }),
      ask({ source: 'niete_portal_share', created_at: ago(5 * 60), delivered_at: ago(5 * 60 - 1) }),
      failedAsk({ source: 'niete_portal_share', error_code: 'DELIVERY_FAILED', created_at: ago(4 * 60) }),
      failedAsk({ source: 'niete_portal_share', error_code: 'DELIVERY_FAILED', created_at: ago(30) }),
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out).toEqual(expect.objectContaining({ verdict: 'healthy', reasons: [] }));
  });

  test('content answers and asks still in flight neither count nor break the run', async () => {
    mockDb.tables.lesson_plan_requests = [
      ask({ created_at: ago(10 * 60), delivered_at: ago(10 * 60 - 1) }),
      failedAsk({ error_code: 'GENERATION_FAILED', created_at: ago(6 * 60) }),
      failedAsk({ error_code: 'NO_ASSET', created_at: ago(5 * 60) }),
      failedAsk({ error_code: 'GENERATION_FAILED', created_at: ago(3 * 60) }),
      failedAsk({ error_code: 'NOT_ELIGIBLE', created_at: ago(2 * 60) }),
      failedAsk({ error_code: 'GENERATION_FAILED', created_at: ago(40) }),
      ask({ status: 'processing', delivered_at: null, created_at: ago(20) }),
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.reasons).toEqual(['down:niete_v8_segment/whatsapp']);
  });

  test('a plan made and then refused by WhatsApp (completed + DELIVERY_FAILED, no delivered_at) is a failed attempt, not a delivery', async () => {
    // markCompleted keeps status completed for the queue when the send is refused, and says DELIVERY_FAILED
    mockDb.tables.lesson_plan_requests = [60, 45, 30].map((m) => ask({
      source: 'niete_grounded', status: 'completed', error_code: 'DELIVERY_FAILED', delivered_at: null, created_at: ago(m * 10),
    }));
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.reasons).toEqual(['down:niete_grounded/whatsapp']);
  });

  test('a curriculum ask with attempts left is still in flight — not yet a failed attempt', async () => {
    mockDb.tables.lesson_plan_requests = [
      failedAsk({ source: 'niete_grounded', error_code: 'RENDER_FAILED', retry_count: 2, created_at: ago(40) }),
    ];
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.verdict).toBe('healthy');
  });

  test('failures older than a day are not a run', async () => {
    mockDb.tables.lesson_plan_requests = [25, 26, 27].map((h) => failedAsk({ error_code: 'RENDER_FAILED', created_at: ago(h * 60) }));
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.verdict).toBe('healthy');
  });

  test('a path the window rate already flags keeps its ONE reason', async () => {
    mockDb.tables.lesson_plan_requests = Array.from({ length: 5 }, (_, i) => failedAsk({
      source: 'niete_oxbridge', error_code: 'RENDER_FAILED', created_at: ago(20 + i),
    }));
    const out = await Health.run({ now: NOW, redis: fakeRedis() });
    expect(out.reasons).toEqual(['failure_rate:niete_oxbridge/whatsapp']);
  });

  test('the on-demand view says it too', async () => {
    mockDb.tables.lesson_plan_requests = [
      failedAsk({ source: 'niete_grounded', error_code: 'RENDER_FAILED', retry_count: 3, created_at: ago(40) }),
    ];
    const view = await Health.onDemand({ now: NOW });
    expect(view).toEqual(expect.objectContaining({ status: 'degraded', reasons: ['down:niete_grounded/whatsapp'] }));
  });
});
