'use strict';
/**
 * When the queue service cannot read a request row's `source` (to decide whether the row is the grounded
 * path's own), the failure is reported like every other lifecycle failure: counted every time
 * (`lesson_plan.lifecycle.write_failed`), said at error level at most once per ten minutes per kind.
 *
 * WHY. markCompleted and markFailed run for every row the generation worker finishes. The read fails on
 * every one of them when LP_LIFECYCLE_PATHS is set before migration V1.6.4 has added the column (42703):
 * an error-level line per finished request would bury the one line that says what to do. The lifecycle
 * writer already says that ("apply migration V1.6.4"), once per ten minutes; the read goes through it.
 *
 * Faked: the database (every read of `source` fails as on a database without V1.6.4; updates succeed)
 * and the loggers. The queue service and the lifecycle writer are real.
 */

const MISSING = { code: '42703', message: 'column lesson_plan_requests.source does not exist' };
const mockBuilder = (kind) => {
  const result = kind === 'select' ? { data: null, error: MISSING } : { data: null, error: null };
  const b = new Proxy({}, {
    get: (_, k) => (k === 'then' ? (res, rej) => Promise.resolve(result).then(res, rej) : () => b),
  });
  return b;
};
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({
    select: () => mockBuilder('select'),
    update: () => mockBuilder('update'),
    insert: () => mockBuilder('update'),
  }),
}));
jest.mock('../../bot/shared/services/queue', () => ({ queueCoachingJob: jest.fn().mockResolvedValue(true) }));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
const mockEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => 'corr-read-1',
}));

const Lifecycle = require('../../bot/shared/services/lesson-plan-lifecycle.service');
const LessonPlanQueueService = require('../../bot/shared/services/lesson-plan-queue.service');

const errorLines = () => mockLog.mock.calls.filter((c) => c[2] === 'error');
const writeFailedEvents = () => mockEvent.mock.calls.filter(([n]) => n === 'lesson_plan.lifecycle.write_failed');

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.REGION = 'niete';
  process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
  mockLog.mockClear();
  mockEvent.mockClear();
  Lifecycle.__resetForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

test('the switch set before V1.6.4: every finished request is counted, and the error line is said ONCE, naming the migration', async () => {
  await LessonPlanQueueService.markCompleted('req-1', { gammaUrl: 'g', pdfUrl: 'p', sent: true });
  await LessonPlanQueueService.markFailed('req-2', 'Gamma said no', 'RENDER_FAILED');
  await LessonPlanQueueService.markCompleted('req-3', { gammaUrl: 'g', pdfUrl: 'p', sent: true });

  expect(writeFailedEvents()).toHaveLength(3);
  expect(writeFailedEvents()[0][1]).toEqual(expect.objectContaining({ code: '42703', requestId: 'req-1', source: 'niete_grounded', table: 'lesson_plan_requests' }));
  expect(errorLines()).toHaveLength(1);
  expect(String(errorLines()[0][0])).toMatch(/V1\.6\.4/);
});

test('the row is still updated exactly as before: the read failing stamps nothing and throws nothing', async () => {
  await expect(LessonPlanQueueService.markCompleted('req-4', { gammaUrl: 'g', pdfUrl: 'p', sent: true })).resolves.not.toThrow();
  expect(mockEvent.mock.calls.filter(([n]) => n === 'lesson_plan.delivery.sent')).toHaveLength(0);
});
