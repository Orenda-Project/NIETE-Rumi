'use strict';
/**
 * bd-v0toag.10 (b) — the day-3 retest sweep runs on the worker: main-queue replicas only, a boot
 * run 2 minutes in and then hourly from that run, timers unref'd, a throwing sweep never takes the
 * worker with it. The switch is read by the sweep on every tick, so flipping it needs no deploy.
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

const { scheduleQuizRetest, FIRST_MS, TICK_MS } = require('../../bot/workers/quiz-retest-schedule');

const timers = () => {
  let bootRun;
  const setTimeoutFn = jest.fn((fn) => { bootRun = fn; return { unref: jest.fn() }; });
  const setIntervalFn = jest.fn(() => ({ unref: jest.fn() }));
  return { setTimeoutFn, setIntervalFn, boot: () => bootRun() };
};

beforeEach(() => mockLogToFile.mockClear());

test('not a main-queue replica → not scheduled, said', () => {
  const t = timers();
  expect(scheduleQuizRetest({ hasMainQueue: false, ...t })).toBeNull();
  expect(t.setTimeoutFn).not.toHaveBeenCalled();
  expect(mockLogToFile).toHaveBeenCalledWith(expect.stringMatching(/retest.*not scheduled/i), expect.anything());
});

test('main queue → boot run at 2 min, hourly from that run, both unref\'d', async () => {
  const t = timers();
  const sweep = jest.fn(async () => ({ made: 0 }));
  const out = scheduleQuizRetest({ hasMainQueue: true, sweep, ...t });
  expect(FIRST_MS).toBe(2 * 60 * 1000);
  expect(TICK_MS).toBe(60 * 60 * 1000);
  expect(t.setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), FIRST_MS);
  expect(t.setTimeoutFn.mock.results[0].value.unref).toHaveBeenCalled();
  expect(t.setIntervalFn).not.toHaveBeenCalled();
  await t.boot();
  expect(t.setIntervalFn).toHaveBeenCalledWith(out.tick, TICK_MS);
  expect(out.timer.unref).toHaveBeenCalled();
  expect(sweep).toHaveBeenCalledTimes(1);
});

test('a sweep that throws is logged and swallowed', async () => {
  const out = scheduleQuizRetest({ hasMainQueue: true, sweep: jest.fn(async () => { throw new Error('boom'); }), ...timers() });
  await expect(out.tick()).resolves.toBeNull();
  expect(mockLogToFile).toHaveBeenCalledWith(expect.stringMatching(/retest sweep/i), { error: 'boom' }, 'error');
});

test('a tick while the worker shuts down does not sweep', async () => {
  const sweep = jest.fn();
  const out = scheduleQuizRetest({ hasMainQueue: true, worker: { isShuttingDown: true }, sweep, ...timers() });
  await out.tick();
  expect(sweep).not.toHaveBeenCalled();
});

test('the worker boot step schedules it on a main-queue replica', () => {
  jest.useFakeTimers();
  const saved = process.env.WORKER_QUEUES;
  try {
    process.env.WORKER_QUEUES = 'main';
    require('../../bot/workers/sqs-worker').schedulePeriodicChecks({ worker: { isShuttingDown: false } });
    expect(mockLogToFile).toHaveBeenCalledWith(expect.stringMatching(/^Quiz retest sweep scheduled/));
  } finally {
    if (saved === undefined) delete process.env.WORKER_QUEUES; else process.env.WORKER_QUEUES = saved;
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
