/**
 * bd-awqt3, part 2 — WORKER_QUEUES being unset was invisible.
 *
 * The actual staging misconfiguration behind bd-awqt3: `sqs-worker` and `sqs-worker-video` both
 * run the identical `node bot/workers/sqs-worker.js`, WORKER_QUEUES is unset on both, and
 * `_enabledQueues()` (sqs-worker.js:~139) defaults an unset value to `{main, video, quiz}` — so
 * BOTH services poll the `main` queue, and lp612_author (which has no dedicated queue of its own;
 * it rides `main` — see queueJob() in lp612-serving.service.js) can land on either one. The two
 * services disagree on LP612_AUTHOR_TIMEOUT_MS (720s vs 840s) and LP612_AUTHOR_ROUNDS (3 vs 5),
 * so the SAME lesson gets a different authoring depth and a different deadline depending on which
 * container happened to grab it — and nothing anywhere logged that this was even possible.
 *
 * `WORKER_QUEUES` unset is a legitimate default for a single-worker deployment (poll everything).
 * This does not make it wrong to leave unset — it makes it wrong that leaving it unset was
 * SILENT. `resolveWorkerQueuesBootStatus()` is what a boot-time log line uses to say, every time
 * this worker starts, whether it is polling a subset or defaulting to all three queues — so this
 * configuration is visible in Railway boot logs instead of only inferable after an incident.
 */

jest.mock('express', () => {
  const app = { get: jest.fn(), listen: jest.fn(() => ({})) };
  return jest.fn(() => app);
}, { virtual: true });

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendDocumentByLink: jest.fn(),
}));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../bot/workers/lesson-plan-extraction.worker', () => ({}));
jest.mock('../../bot/workers/lesson-plan-generation.worker', () => ({}));
jest.mock('../../bot/workers/video-generation.worker', () => ({}));
jest.mock('../../bot/workers/exam-grading.worker', () => ({}));
jest.mock('../../bot/shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn() }));
jest.mock('../../bot/shared/services/lesson-plan-queue.service', () => ({}));
jest.mock('../../bot/shared/services/queue', () => ({
  __isQueueSingleton: true, extendJobTimeout: jest.fn(() => Promise.resolve()),
}));

const mockLogToFile = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogToFile(...a) }));

describe('resolveWorkerQueuesBootStatus (bd-awqt3)', () => {
  const ORIGINAL = process.env.WORKER_QUEUES;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.WORKER_QUEUES;
    else process.env.WORKER_QUEUES = ORIGINAL;
  });

  test('unset WORKER_QUEUES is reported as defaulted to all three queues', () => {
    delete process.env.WORKER_QUEUES;
    jest.resetModules();
    // eslint-disable-next-line global-require
    const { resolveWorkerQueuesBootStatus } = require('../../bot/workers/sqs-worker');

    const status = resolveWorkerQueuesBootStatus();

    expect(status.isDefaulted).toBe(true);
    expect(status.raw).toBeNull();
    expect(status.enabled.sort()).toEqual(['main', 'quiz', 'video']);
  });

  test('an explicit WORKER_QUEUES is reported as NOT defaulted, with the queues it names', () => {
    process.env.WORKER_QUEUES = 'video';
    jest.resetModules();
    // eslint-disable-next-line global-require
    const { resolveWorkerQueuesBootStatus } = require('../../bot/workers/sqs-worker');

    const status = resolveWorkerQueuesBootStatus();

    expect(status.isDefaulted).toBe(false);
    expect(status.raw).toBe('video');
    expect(status.enabled).toEqual(['video']);
  });

  test('boot logs a LOUD warning when WORKER_QUEUES is unset — this used to be silent', () => {
    delete process.env.WORKER_QUEUES;
    jest.resetModules();
    mockLogToFile.mockClear();

    // Requiring the module IS booting it (module-scope boot logging, matching the existing
    // "Starting SQS Coaching Worker" line right beside it) — no separate start() call needed.
    // eslint-disable-next-line global-require
    require('../../bot/workers/sqs-worker');

    const warned = mockLogToFile.mock.calls.some(
      (call) => typeof call[0] === 'string' && /WORKER_QUEUES/.test(call[0]) && /unset/i.test(call[0]),
    );
    expect(warned).toBe(true);
  });

  test('boot does NOT warn when WORKER_QUEUES is explicitly set', () => {
    process.env.WORKER_QUEUES = 'main,quiz';
    jest.resetModules();
    mockLogToFile.mockClear();

    // eslint-disable-next-line global-require
    require('../../bot/workers/sqs-worker');

    const warned = mockLogToFile.mock.calls.some(
      (call) => typeof call[0] === 'string' && /WORKER_QUEUES/.test(call[0]) && /unset/i.test(call[0]),
    );
    expect(warned).toBe(false);
  });
});
