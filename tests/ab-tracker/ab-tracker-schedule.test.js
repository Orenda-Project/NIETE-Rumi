'use strict';
/**
 * The A/B tracker's nightly rollup is ticked by the worker (bot/workers/ab-tracker-schedule.js): main-queue
 * replicas only, a boot tick 4 minutes in and then hourly from that tick, timers unref'd, a throwing run never takes
 * the worker with it. The run reads its own switch (ab_tracker_rollup_enabled) on every tick, so a flip needs no deploy.
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

const { scheduleAbTracker, FIRST_MS, TICK_MS } = require('../../bot/workers/ab-tracker-schedule');

const timers = () => {
  let bootRun;
  const setTimeoutFn = jest.fn((fn) => { bootRun = fn; return { unref: jest.fn() }; });
  const setIntervalFn = jest.fn(() => ({ unref: jest.fn() }));
  return { setTimeoutFn, setIntervalFn, boot: () => bootRun() };
};

beforeEach(() => mockLogToFile.mockClear());

test('not a main-queue replica → not scheduled, said', () => {
  const t = timers();
  expect(scheduleAbTracker({ hasMainQueue: false, ...t })).toBeNull();
  expect(t.setTimeoutFn).not.toHaveBeenCalled();
  expect(mockLogToFile).toHaveBeenCalledWith(expect.stringMatching(/A\/B tracker.*not scheduled/i), expect.anything());
});

test('main queue → boot tick at 4 min, hourly from that tick, both unref\'d', async () => {
  const t = timers();
  const run = jest.fn(async () => ({ outcome: 'off' }));
  const out = scheduleAbTracker({ hasMainQueue: true, run, ...t });
  expect(FIRST_MS).toBe(4 * 60 * 1000);
  expect(TICK_MS).toBe(60 * 60 * 1000);
  expect(t.setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), FIRST_MS);
  expect(t.setTimeoutFn.mock.results[0].value.unref).toHaveBeenCalled();
  expect(t.setIntervalFn).not.toHaveBeenCalled();
  await t.boot();
  expect(t.setIntervalFn).toHaveBeenCalledWith(out.tick, TICK_MS);
  expect(out.timer.unref).toHaveBeenCalled();
  expect(run).toHaveBeenCalledTimes(1);
});

test('a run that throws is logged and swallowed', async () => {
  const out = scheduleAbTracker({ hasMainQueue: true, run: jest.fn(async () => { throw new Error('boom'); }), ...timers() });
  await expect(out.tick()).resolves.toBeNull();
  expect(mockLogToFile).toHaveBeenCalledWith(expect.stringMatching(/A\/B tracker/i), { error: 'boom' }, 'error');
});

test('a tick while the worker shuts down does not run', async () => {
  const run = jest.fn();
  const out = scheduleAbTracker({ hasMainQueue: true, worker: { isShuttingDown: true }, run, ...timers() });
  await out.tick();
  expect(run).not.toHaveBeenCalled();
});

test('the worker boot step schedules it on a main-queue replica', () => {
  jest.useFakeTimers();
  const saved = process.env.WORKER_QUEUES;
  try {
    process.env.WORKER_QUEUES = 'main';
    require('../../bot/workers/sqs-worker').schedulePeriodicChecks({ worker: { isShuttingDown: false } });
    expect(mockLogToFile).toHaveBeenCalledWith(expect.stringMatching(/^A\/B tracker rollup scheduled/));
  } finally {
    if (saved === undefined) delete process.env.WORKER_QUEUES; else process.env.WORKER_QUEUES = saved;
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test('the worker wires it beside the teacher activity job, guarded so a failure is non-fatal', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../bot/workers/sqs-worker.js'), 'utf8');
  expect(src).toMatch(/require\('\.\/ab-tracker-schedule'\)\.scheduleAbTracker\(\{ worker: w, hasMainQueue: SQSCoachingWorker\._enabledQueues\(\)\.has\('main'\) \}\)/);
  expect(src).toMatch(/Error scheduling the A\/B tracker rollup \(non-fatal\)/);
});
