'use strict';
/**
 * The worker runs the lesson-plan health check: an hourly tick plus a boot run, on main-queue
 * replicas only — and a check that throws never takes the worker with it.
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

const { runLessonPlanHealth, scheduleLessonPlanHealth } = require('../../bot/workers/sqs-worker');

let savedQueues;
let savedPaths;
beforeEach(() => {
  mockLogToFile.mockClear();
  savedQueues = process.env.WORKER_QUEUES;
  savedPaths = process.env.LP_LIFECYCLE_PATHS;
  delete process.env.LP_LIFECYCLE_PATHS;
});
afterEach(() => {
  if (savedQueues === undefined) delete process.env.WORKER_QUEUES; else process.env.WORKER_QUEUES = savedQueues;
  if (savedPaths === undefined) delete process.env.LP_LIFECYCLE_PATHS; else process.env.LP_LIFECYCLE_PATHS = savedPaths;
});

test('the tick reaches the real check, which is a no-op until a lifecycle path is on', async () => {
  await expect(runLessonPlanHealth()).resolves.toEqual({ outcome: 'off' });
});

test('a check that throws is logged at error level and never takes the worker with it', async () => {
  const health = { run: jest.fn(async () => { throw new Error('boom'); }) };
  await expect(runLessonPlanHealth({ health })).resolves.toBeNull();
  expect(mockLogToFile).toHaveBeenCalledWith(expect.stringMatching(/lesson-plan health/i), { error: 'boom' }, 'error');
});

test('a main-queue replica schedules a boot run (3 min) and an hourly tick', () => {
  process.env.WORKER_QUEUES = 'main,quiz';
  const setTimeoutFn = jest.fn(() => ({ unref() {} }));
  const setIntervalFn = jest.fn(() => 'timer');
  const out = scheduleLessonPlanHealth({ setTimeoutFn, setIntervalFn });
  expect(out).toEqual(expect.objectContaining({ timer: 'timer', tick: expect.any(Function) }));
  expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 3 * 60 * 1000);
  expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
});

test('LP_HEALTH_CHECK=off is its own kill switch: not scheduled, and a tick is a no-op', async () => {
  process.env.WORKER_QUEUES = 'main';
  process.env.LP_LIFECYCLE_PATHS = 'all';
  process.env.LP_HEALTH_CHECK = 'off';
  try {
    const setIntervalFn = jest.fn();
    expect(scheduleLessonPlanHealth({ setTimeoutFn: jest.fn(), setIntervalFn })).toBeNull();
    expect(setIntervalFn).not.toHaveBeenCalled();
    await expect(runLessonPlanHealth()).resolves.toEqual({ outcome: 'off' });
  } finally {
    delete process.env.LP_HEALTH_CHECK;
  }
});

test('a video-only replica does not schedule it', () => {
  process.env.WORKER_QUEUES = 'video';
  const setIntervalFn = jest.fn();
  expect(scheduleLessonPlanHealth({ setTimeoutFn: jest.fn(), setIntervalFn })).toBeNull();
  expect(setIntervalFn).not.toHaveBeenCalled();
});

describe('every tick says what it did', () => {
  // NIETE has no Railway Cron: this check rides the worker, which redeploys several times a day. A tick
  // that returned early in silence would look exactly like a timer that never fired.
  test('a tick with no path switched on logs one line naming its outcome (the real check)', async () => {
    await runLessonPlanHealth();
    expect(mockLogToFile).toHaveBeenCalledWith('Lesson-plan health tick', expect.objectContaining({ outcome: 'off' }));
  });

  test('a skipped tick names why', async () => {
    const health = { run: jest.fn(async () => ({ outcome: 'skipped', reason: 'other' })) };
    await runLessonPlanHealth({ health });
    expect(mockLogToFile).toHaveBeenCalledWith('Lesson-plan health tick', expect.objectContaining({ outcome: 'skipped', reason: 'other' }));
  });

  test('a checked tick names its verdict', async () => {
    const health = { run: jest.fn(async () => ({ outcome: 'checked', verdict: 'healthy', reasons: [], stuck: 0, sources: [] })) };
    await expect(runLessonPlanHealth({ health })).resolves.toEqual(expect.objectContaining({ outcome: 'checked' }));
    expect(mockLogToFile).toHaveBeenCalledWith('Lesson-plan health tick', expect.objectContaining({ outcome: 'checked', verdict: 'healthy' }));
  });

  test('a tick that lands while the worker shuts down says so', () => {
    process.env.WORKER_QUEUES = 'main';
    const scheduled = scheduleLessonPlanHealth({
      worker: { isShuttingDown: true }, setTimeoutFn: jest.fn(() => ({ unref() {} })), setIntervalFn: jest.fn(() => 'timer'),
    });
    mockLogToFile.mockClear();
    scheduled.tick();
    expect(mockLogToFile).toHaveBeenCalledWith('Lesson-plan health tick', expect.objectContaining({ outcome: 'skipped', reason: 'shutting_down' }));
  });
});
