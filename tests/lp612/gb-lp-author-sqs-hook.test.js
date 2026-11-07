/**
 * bd-rj6w0n.14.16.12 — sqs-worker.js routes `gb_lp_author` (a GB lesson written at runtime) to
 * gb-lp-author.worker under the SAME visibility heartbeat as `lp612_author`: the author is the same,
 * so the run is just as long, and a single fixed extension would hand the lesson to a second worker.
 * It is also a long job for shutdown, so a deploy drains it instead of killing it mid-author.
 *
 * Same harness as visibility-heartbeat.test.js: the real executeJob, mocking only the SQS boundary,
 * the worker it delegates to, and the modules sqs-worker.js needs just to be required.
 */

jest.mock('express', () => {
  const app = { get: jest.fn(), listen: jest.fn(() => ({})) };
  return jest.fn(() => app);
}, { virtual: true });

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(),
  sendDocumentByLink: jest.fn(),
}));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../bot/workers/lesson-plan-extraction.worker', () => ({}));
jest.mock('../../bot/workers/lesson-plan-generation.worker', () => ({}));
jest.mock('../../bot/workers/video-generation.worker', () => ({}));
jest.mock('../../bot/workers/exam-grading.worker', () => ({}));
jest.mock('../../bot/shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn() }));
jest.mock('../../bot/shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockExtendJobTimeout = jest.fn(() => Promise.resolve());
jest.mock('../../bot/shared/services/queue', () => ({
  __isQueueSingleton: true,
  extendJobTimeout: (...a) => mockExtendJobTimeout(...a),
}));

let mockGbProcess;
const mockLp612Process = jest.fn();
jest.mock('../../bot/workers/gb-lp-author.worker', () => ({
  process: (...a) => mockGbProcess(...a),
}));
jest.mock('../../bot/workers/lp612-author.worker', () => ({
  process: (...a) => mockLp612Process(...a),
}));

async function flush(times = 10) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('gb_lp_author on the SQS worker', () => {
  let SQSCoachingWorker;
  let worker;
  let deferred;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    mockExtendJobTimeout.mockReset();
    mockExtendJobTimeout.mockImplementation(() => Promise.resolve());
    mockLp612Process.mockReset();
    deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    });
    mockGbProcess = jest.fn(() => deferred.promise);
    process.env.LP612_AUTHOR_TIMEOUT_MS = '720000';
    // eslint-disable-next-line global-require
    ({ SQSCoachingWorker } = require('../../bot/workers/sqs-worker'));
    worker = new SQSCoachingWorker('test-worker');
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.LP612_AUTHOR_TIMEOUT_MS;
  });

  const PAYLOAD = {
    renderId: 'r1', segmentId: 'nbf_snc_grade_3_maths.c04.s002', lang: 'en', templateVersion: 'gb_k5_v10',
  };

  test('hands the payload to the GB worker, never the ICT one', async () => {
    const run = worker.executeJob('sess-1', 'gb_lp_author', PAYLOAD, 'receipt-1', 'main', {});
    await flush();
    deferred.resolve({ status: 'ready' });
    await run;
    expect(mockGbProcess).toHaveBeenCalledWith(PAYLOAD);
    expect(mockLp612Process).not.toHaveBeenCalled();
  });

  test('a run still going minutes in keeps being re-extended, and stops once it settles', async () => {
    const run = worker.executeJob('sess-2', 'gb_lp_author', PAYLOAD, 'receipt-2', 'main', {});
    await flush();
    expect(mockExtendJobTimeout).toHaveBeenCalledWith('receipt-2', 900);

    await jest.advanceTimersByTimeAsync(4 * 60 * 1000);
    await flush();
    expect(mockExtendJobTimeout.mock.calls.length).toBeGreaterThan(1);

    deferred.reject(new Error('author blew up'));
    await expect(run).rejects.toThrow('author blew up');
    mockExtendJobTimeout.mockClear();
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    await flush();
    expect(mockExtendJobTimeout).not.toHaveBeenCalled();
  });

  test('is a long job, so a deploy drains it rather than killing it mid-author', () => {
    expect(SQSCoachingWorker.LONG_JOB_TYPES.has('gb_lp_author')).toBe(true);
  });
});
