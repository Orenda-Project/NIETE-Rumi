'use strict';
/**
 * The lesson-plan health check runs every hour after a boot — including the hour after the boot run.
 *
 * Each main-queue replica runs the check once 3 minutes after boot and then hourly; one replica per tick
 * wins a claim in Redis that lives 59 minutes. The hourly timer was anchored at BOOT, so the first hourly
 * tick (boot + 60) came only 57 minutes after the boot run's claim and was refused on every replica —
 * the boot run's own included, the claim token being new each tick. Seen live on staging (10 replicas,
 * 2026-10-15/16): after each deploy the check skipped an hour, so a verdict could be two hours late.
 * Nothing was lost (the windows chain from the watermark), only time. The hourly timer now starts at
 * the boot run, so every tick is a full hour after the one before.
 *
 * Faked: the clock (Jest timers), the cache (a store that honours TTLs on that clock, like Redis), the
 * database (in memory, no rows) and the modules the worker file loads that the check never touches. The
 * scheduler, the tick and the health check itself are real.
 */
jest.mock('express', () => {
  const app = { get: jest.fn(), listen: jest.fn(() => ({})) };
  return jest.fn(() => app);
}, { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocumentByLink: jest.fn() }));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../bot/workers/lesson-plan-extraction.worker', () => ({}));
jest.mock('../../bot/workers/lesson-plan-generation.worker', () => ({}));
jest.mock('../../bot/workers/video-generation.worker', () => ({}));
jest.mock('../../bot/workers/exam-grading.worker', () => ({}));
jest.mock('../../bot/shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn() }));
jest.mock('../../bot/shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../bot/shared/services/queue', () => ({ __isQueueSingleton: true, extendJobTimeout: jest.fn(() => Promise.resolve()) }));
const mockLogToFile = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogToFile(...a) }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
jest.mock('../../bot/shared/config/supabase', () => mockDb);

// Redis as the claim sees it: a key set with a TTL is gone once that TTL has passed on the clock.
const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => {
  const live = (k) => { const e = mockStore.get(k); return e && e.expiresAt > Date.now() ? e : null; };
  return {
    isAvailable: () => true,
    async setNX(k, v, ttlS) { if (live(k)) return false; mockStore.set(k, { value: v, expiresAt: Date.now() + ttlS * 1000 }); return true; },
    async get(k) { const e = live(k); return e ? e.value : null; },
    async set(k, v, ttlS) { mockStore.set(k, { value: v, expiresAt: ttlS ? Date.now() + ttlS * 1000 : Infinity }); return true; },
  };
});

const { scheduleLessonPlanHealth } = require('../../bot/workers/sqs-worker');
const Health = require('../../bot/shared/services/monitoring/lesson-plan-health.service');

const MIN = 60 * 1000;
const outcomes = () => mockLogToFile.mock.calls
  .filter(([msg]) => msg === 'Lesson-plan health tick').map(([, fields]) => fields.outcome);

const ENV_KEYS = ['WORKER_QUEUES', 'LP_LIFECYCLE_PATHS', 'LP_HEALTH_CHECK'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.WORKER_QUEUES = 'main,quiz';
  process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
  delete process.env.LP_HEALTH_CHECK;
  mockLogToFile.mockClear();
  mockStore.clear();
  mockDb.reset({ lesson_plan_requests: [] });
  if (Health.__resetForTests) Health.__resetForTests();
  jest.useFakeTimers({ now: new Date('2026-10-16T10:00:00Z') });
});
afterEach(() => {
  jest.useRealTimers();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

test('after a boot the check runs every hour: the tick after the boot run is not refused by the boot run\'s claim', async () => {
  scheduleLessonPlanHealth({});
  await jest.advanceTimersByTimeAsync(3 * MIN);         // the boot run
  expect(outcomes()).toEqual(['checked']);
  await jest.advanceTimersByTimeAsync(120 * MIN + 1000); // the next two hours
  expect(outcomes()).toEqual(['checked', 'checked', 'checked']);
});

test('two replicas booted together still check once per tick between them', async () => {
  scheduleLessonPlanHealth({});
  scheduleLessonPlanHealth({});
  await jest.advanceTimersByTimeAsync(3 * MIN);
  expect(outcomes().sort()).toEqual(['checked', 'skipped']);
  await jest.advanceTimersByTimeAsync(60 * MIN + 1000);
  expect(outcomes().filter((o) => o === 'checked')).toHaveLength(2);
  expect(outcomes()).toHaveLength(4);
});
