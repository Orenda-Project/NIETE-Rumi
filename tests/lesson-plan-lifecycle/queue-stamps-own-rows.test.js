'use strict';
/**
 * The queue service stamps lifecycle stage columns and emits lifecycle events ONLY on request rows the
 * grounded path recorded.
 *
 * markCompleted and markFailed run for every request row the generation worker finishes. On the sandbox
 * every such row is a grounded one, but staging and production still generate FREEFORM Gamma plans
 * through the same service and worker, and a row asked before the path was switched on has no source
 * either. Stamping those would give a freeform row stage times and an error code without a path, and
 * emit a failure or delivery event claiming `niete_grounded` for a plan that path never made. A row the
 * path did not record is updated exactly as before; switched off, the service makes no extra read.
 *
 * Faked: the database (in memory) and the logger. The queue service and the lifecycle writer are real.
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase({}, { projectSelect: true });
const mockEvent = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/queue', () => ({ queueCoachingJob: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => 'corr-queue-1',
}));

const LessonPlanQueueService = require('../../bot/shared/services/lesson-plan-queue.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const LIFECYCLE_KEYS = ['generated_at', 'delivered_at', 'error_code'];
const row = (id) => mockDb.rows('lesson_plan_requests').find((r) => r.id === id);
const lifecycleEvents = () => mockEvent.mock.calls.filter(([n]) => String(n).startsWith('lesson_plan.'));

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.REGION = 'niete';
  process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
  jest.clearAllMocks();
  mockDb.reset({
    lesson_plan_requests: [
      // recorded by the grounded path
      { id: 'req-grounded', user_id: TEACHER, status: 'processing', retry_count: 0, source: 'niete_grounded', channel: 'whatsapp' },
      // a freeform Gamma plan (or a row asked before the switch): no source
      { id: 'req-freeform', user_id: TEACHER, status: 'processing', retry_count: 0, content_type: 'lesson_plan' },
    ],
  });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

test('a completed freeform row is updated exactly as before: no stage columns, no event', async () => {
  await LessonPlanQueueService.markCompleted('req-freeform', { gammaUrl: 'g', pdfUrl: 'p', generatedAt: new Date().toISOString(), sent: true });
  const r = row('req-freeform');
  expect(r).toEqual(expect.objectContaining({ status: 'completed', gamma_url: 'g', pdf_url: 'p' }));
  for (const k of LIFECYCLE_KEYS) expect(r).not.toHaveProperty(k);
  expect(lifecycleEvents()).toHaveLength(0);
});

test('a failed freeform row is updated exactly as before: no error code, no event', async () => {
  await LessonPlanQueueService.markFailed('req-freeform', 'Gamma said no', 'RENDER_FAILED');
  const r = row('req-freeform');
  expect(r).toEqual(expect.objectContaining({ status: 'failed', error_message: 'Gamma said no', retry_count: 1 }));
  for (const k of LIFECYCLE_KEYS) expect(r).not.toHaveProperty(k);
  expect(lifecycleEvents()).toHaveLength(0);
});

test('the grounded row is stamped and announced, completed and failed alike', async () => {
  await LessonPlanQueueService.markCompleted('req-grounded', { gammaUrl: 'g', pdfUrl: 'p', generatedAt: new Date().toISOString(), sent: true });
  expect(row('req-grounded')).toEqual(expect.objectContaining({ status: 'completed', generated_at: expect.any(String), delivered_at: expect.any(String) }));
  expect(mockEvent).toHaveBeenCalledWith('lesson_plan.delivery.sent', expect.objectContaining({ requestId: 'req-grounded', source: 'niete_grounded' }));

  await LessonPlanQueueService.markFailed('req-grounded', 'Gamma said no', 'RENDER_FAILED');
  expect(row('req-grounded')).toEqual(expect.objectContaining({ status: 'failed', error_code: 'RENDER_FAILED' }));
  expect(mockEvent).toHaveBeenCalledWith('lesson_plan.generation.failed', expect.objectContaining({ requestId: 'req-grounded', attempt: 1, final: false }));
});

test('switched OFF: no extra read, and every row updated exactly as before', async () => {
  delete process.env.LP_LIFECYCLE_PATHS;
  mockDb.from.mockClear();
  await LessonPlanQueueService.markFailed('req-grounded', 'Gamma said no', 'RENDER_FAILED');
  await LessonPlanQueueService.markCompleted('req-freeform', { gammaUrl: 'g', pdfUrl: 'p', sent: true });
  // markFailed reads retry_count and updates; markCompleted updates. Nothing else.
  expect(mockDb.from).toHaveBeenCalledTimes(3);
  expect(row('req-grounded')).not.toHaveProperty('error_code', 'RENDER_FAILED');
  expect(lifecycleEvents()).toHaveLength(0);
});
