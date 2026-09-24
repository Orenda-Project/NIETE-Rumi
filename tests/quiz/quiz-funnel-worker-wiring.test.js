'use strict';
/**
 * The worker runs the quiz funnel watcher — and no longer the hourly digest.
 *
 * `runQuizFunnelWatch` is what the worker's boot timer and 15-minute interval
 * call. It must hand the tick to the watcher and must never throw: a monitor that
 * can take the worker down takes down the thing it watches. The hourly failure
 * digest it replaces is gone from the worker boot AND from the codebase, so there
 * is exactly one sender to the operator.
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

const { runQuizFunnelWatch } = require('../../bot/workers/sqs-worker');

beforeEach(() => {
  mockLogToFile.mockClear();
  delete process.env.QUIZ_FUNNEL_WATCH_ENABLED;
});

test('the tick reaches the real watcher, which is a no-op until armed', async () => {
  await expect(runQuizFunnelWatch()).resolves.toEqual({ skipped: 'disabled' });
});

test('a watcher that throws is logged at error level and never takes the worker with it', async () => {
  const watch = { run: jest.fn(async () => { throw new Error('boom'); }) };
  await expect(runQuizFunnelWatch({ watch })).resolves.toBeNull();
  expect(watch.run).toHaveBeenCalledTimes(1);
  expect(mockLogToFile).toHaveBeenCalledWith(expect.stringMatching(/quiz funnel watch/i), { error: 'boom' }, 'error');
});

test('the hourly digest is gone — one sender to the operator', () => {
  expect(() => require('../../bot/shared/services/monitoring/prod-failure-digest.service')).toThrow(/Cannot find module/);
});
