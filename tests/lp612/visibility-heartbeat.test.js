/**
 * bd-awqt3 — lp612_author's SQS visibility window must track the job for its ENTIRE run, not a
 * single number picked in advance.
 *
 * MEASURED ON STAGING: a load test saw lp612_author jobs run past 936s — 36s past the one-shot
 * 900s visibility extension workers/sqs-worker.js hands out ONCE, up front, in the `lp612_author`
 * case (~line 416). The code comment right there states the invariant this is supposed to
 * guarantee: "the job must give up... BEFORE SQS decides it died and hands the same lesson to a
 * second worker." That invariant does not hold in practice, for two independent reasons:
 *
 *   1. `withTimeout()` in lp612-author.worker.js wraps ONLY authoring + the final render. The PDF
 *      read, both R2 uploads (PDF + lp_doc JSON), the DB writes and the per-waiter WhatsApp
 *      delivery loop all run AFTER that timeout resolves, completely unbounded.
 *   2. Staging runs `LP612_AUTHOR_TIMEOUT_MS` at up to 840s on one worker vs 720s on another
 *      (bd-awqt3), leaving as little as 60s of the 900s window for that unbounded tail.
 *
 * Once the message goes visible again mid-run, a second worker claims the same lesson and
 * duplicate authoring doubles the load — worsening the exact contention that caused the overrun.
 *
 * The fix is a heartbeat (bot/shared/utils/sqs-visibility-heartbeat.js) that re-extends
 * visibility every ~60s for as long as the job is ACTUALLY running, stops the instant it settles
 * (success or failure — via try/finally, so it can never leak), tolerates a single failed
 * extension without giving up on the job, and is bounded by an absolute ceiling so a genuinely
 * hung job is not kept invisible forever.
 *
 * This suite exercises the REAL `lp612_author` case inside sqs-worker.js's `executeJob` — not a
 * copy, not the helper in isolation — mocking only the SQS boundary (the queue service) and the
 * lp612 author worker it delegates to. Every other top-level dependency sqs-worker.js loads is
 * shallow-mocked purely so the module can be required at all in the root test job (it has never
 * been required directly before this — every prior sqs-worker.js test greps the source instead).
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

// THE NETWORK BOUNDARY. Real code: bot/shared/services/queue/sqs-queue.service.js wraps the AWS
// SQS client; this mocks the queue INDEX (what every consumer, including sqs-worker.js, actually
// requires) so no real AWS call is ever made. `extendJobTimeout` is the call under test.
const mockExtendJobTimeout = jest.fn(() => Promise.resolve());
jest.mock('../../bot/shared/services/queue', () => ({
  __isQueueSingleton: true,
  extendJobTimeout: (...a) => mockExtendJobTimeout(...a),
}));

// The lp612 author worker itself is owned by another agent right now and is not under test here
// — only sqs-worker.js's wiring around it is. A controllable, never-resolving-until-told promise
// stands in for "the job is still running".
let mockLp612Process;
jest.mock('../../bot/workers/lp612-author.worker', () => ({
  process: (...a) => mockLp612Process(...a),
}));

/** Flush pending microtasks so `.then()`/`await` chains queued before a fake-timer advance
 *  actually run. Same pattern as tests/lp612/author-worker.test.js's `flush()`. */
async function flush(times = 10) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('lp612_author visibility heartbeat (bd-awqt3)', () => {
  let SQSCoachingWorker;
  let worker;
  let deferred;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    // mockReset (not mockClear): a `mockImplementationOnce` queued by one test but never
    // consumed (e.g. because the code under test only calls extend once) must not leak into the
    // next test and fire there instead.
    mockExtendJobTimeout.mockReset();
    mockExtendJobTimeout.mockImplementation(() => Promise.resolve());

    deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    });
    mockLp612Process = jest.fn(() => deferred.promise);

    process.env.LP612_AUTHOR_TIMEOUT_MS = '720000'; // 12 min, matches the other lp612 suites

    // eslint-disable-next-line global-require
    ({ SQSCoachingWorker } = require('../../bot/workers/sqs-worker'));
    worker = new SQSCoachingWorker('test-worker');
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.LP612_AUTHOR_TIMEOUT_MS;
  });

  const PAYLOAD = { renderId: 'r1', segmentId: 's1', lang: 'en', templateVersion: 'v9.1' };

  test('a job still running minutes in gets re-extended — not just the one up-front call', async () => {
    const runPromise = worker.executeJob('sess-1', 'lp612_author', PAYLOAD, 'receipt-1', 'main', {});
    await flush();

    // The up-front extension (unchanged behaviour) has landed.
    expect(mockExtendJobTimeout).toHaveBeenCalledTimes(1);
    expect(mockExtendJobTimeout).toHaveBeenCalledWith('receipt-1', 900);

    // The job is STILL running 4 minutes later — well inside the 12-minute job timeout used in
    // this test, and well past the point where a one-shot extension needs topping up to still be
    // safe against the unbounded tail described above.
    await jest.advanceTimersByTimeAsync(4 * 60 * 1000);
    await flush();

    // THE ASSERTION. Before the fix, extendJobTimeout is called exactly once, ever, for this job
    // — so a job still running 4 minutes in has received NO heartbeat, and its last visibility
    // extension already happened before authoring even started.
    expect(mockExtendJobTimeout.mock.calls.length).toBeGreaterThan(1);

    deferred.resolve({ status: 'ready' });
    await runPromise;
  });

  test('the heartbeat stops the instant the job succeeds — no extension after settlement', async () => {
    const runPromise = worker.executeJob('sess-2', 'lp612_author', PAYLOAD, 'receipt-2', 'main', {});
    await flush();
    await jest.advanceTimersByTimeAsync(60 * 1000);
    await flush();
    const callsWhileRunning = mockExtendJobTimeout.mock.calls.length;
    expect(callsWhileRunning).toBeGreaterThan(1);

    deferred.resolve({ status: 'ready' });
    await runPromise;

    mockExtendJobTimeout.mockClear();
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    await flush();

    // A completed job's message must not be held invisible by a leaked interval.
    expect(mockExtendJobTimeout).not.toHaveBeenCalled();
  });

  test('the heartbeat also stops when the job FAILS, not only on success', async () => {
    const runPromise = worker.executeJob('sess-3', 'lp612_author', PAYLOAD, 'receipt-3', 'main', {});
    await flush();
    await jest.advanceTimersByTimeAsync(60 * 1000);
    await flush();

    deferred.reject(new Error('author blew up'));
    await expect(runPromise).rejects.toThrow('author blew up');

    mockExtendJobTimeout.mockClear();
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    await flush();

    expect(mockExtendJobTimeout).not.toHaveBeenCalled();
  });

  test('a single failed extension is swallowed — the job is not abandoned over an SQS blip', async () => {
    const runPromise = worker.executeJob('sess-4', 'lp612_author', PAYLOAD, 'receipt-4', 'main', {});
    await flush();

    // The first heartbeat tick fails...
    mockExtendJobTimeout.mockImplementationOnce(() => Promise.reject(new Error('SQS blip')));
    await jest.advanceTimersByTimeAsync(60 * 1000);
    await flush();

    // ...but the job is still running (not killed by the failed extend), and the NEXT heartbeat
    // tick still fires normally.
    mockExtendJobTimeout.mockClear();
    mockExtendJobTimeout.mockImplementation(() => Promise.resolve());
    await jest.advanceTimersByTimeAsync(60 * 1000);
    await flush();
    expect(mockExtendJobTimeout).toHaveBeenCalled();

    // executeJob() itself resolves to undefined on every path (the switch cases only `break`);
    // the meaningful assertion is that it RESOLVES rather than rejecting — i.e. the SQS blip did
    // not abandon the job.
    deferred.resolve({ status: 'ready' });
    await expect(runPromise).resolves.toBeUndefined();
  });

  test('the heartbeat is bounded by an absolute ceiling — it does not extend forever', async () => {
    const runPromise = worker.executeJob('sess-5', 'lp612_author', PAYLOAD, 'receipt-5', 'main', {});
    await flush();

    // Run for a very long time without ever settling (simulating a genuinely hung job). The
    // ceiling must stop new extensions well before this.
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000); // 60 minutes
    await flush();

    const callsNearEnd = mockExtendJobTimeout.mock.calls.length;
    mockExtendJobTimeout.mockClear();
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000); // another 10 minutes
    await flush();

    expect(callsNearEnd).toBeGreaterThan(0);
    // No NEW extensions once the ceiling has been crossed.
    expect(mockExtendJobTimeout).not.toHaveBeenCalled();

    deferred.resolve({ status: 'ready' });
    await runPromise;
  });
});
