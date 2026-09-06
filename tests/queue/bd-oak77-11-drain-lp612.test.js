/**
 * bd-oak77.11 LAYER A — the drain must FINISH an in-flight lp612 authoring run, not abandon it.
 *
 * The operator's requirement: "deploy should never kill in progress authoring lesson plans."
 *
 * Today `shutdown()` waits GRACEFUL_SHUTDOWN_TIMEOUT_MS (30s) for EVERYTHING and then releases
 * every in-flight message back to SQS. For coaching that is right — a 40s transcription either
 * finished inside the window or is cheap to redo. For `lp612_author` it is neither: the job runs
 * 2.5-7 minutes, and releasing it mid-run does not help anybody, because the row is still
 * `authoring` so the next replica re-authors the whole lesson from round 0 at full price.
 *
 * These tests drive the REAL SQSCoachingWorker's real shutdown(), with only the network boundary
 * (SQS) and the logger doubled. Jest fake timers stand in for the wall clock.
 */

const mockRelease = jest.fn(() => Promise.resolve());

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  releaseInFlightMessage: (...a) => mockRelease(...a),
  receiveJobs: jest.fn(() => Promise.resolve([])),
  deleteJob: jest.fn(() => Promise.resolve()),
  extendJobTimeout: jest.fn(() => Promise.resolve()),
}));

let SQSCoachingWorker;

/** A job that never settles on its own; resolve() finishes it. */
function pendingJob() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, finish: () => { resolve(); return promise; } };
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  mockRelease.mockClear();
  process.env.SQS_QUEUE_URL = 'https://sqs/main';
  delete process.env.LP612_DRAIN_TIMEOUT_MS;
  ({ SQSCoachingWorker } = require('../../bot/workers/sqs-worker'));
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.LP612_DRAIN_TIMEOUT_MS;
});

describe('bd-oak77.11 — lp612_author survives a deploy drain', () => {
  it('does NOT release an in-flight lp612_author message at the 30s coaching deadline', async () => {
    const w = new SQSCoachingWorker('w1');
    const job = pendingJob();
    w.activeJobs.set('rh-lp612', { promise: job.promise, sourceQueue: 'main', jobType: 'lp612_author' });

    const done = w.shutdown();
    await jest.advanceTimersByTimeAsync(60_000);   // twice the coaching deadline

    expect(mockRelease).not.toHaveBeenCalled();
    expect(w.activeJobs.size).toBe(1);

    // the lesson finishes, the drain returns, still nothing released
    w.activeJobs.delete('rh-lp612');
    await job.finish();
    await jest.advanceTimersByTimeAsync(1_000);
    await done;
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('waits for the lp612 job and returns as soon as it completes (the lesson is delivered)', async () => {
    const w = new SQSCoachingWorker('w2');
    const job = pendingJob();
    w.activeJobs.set('rh-lp612', { promise: job.promise, sourceQueue: 'main', jobType: 'lp612_author' });

    let settled = false;
    const done = w.shutdown().then(() => { settled = true; });

    await jest.advanceTimersByTimeAsync(240_000);  // 4 minutes into the authoring run
    expect(settled).toBe(false);                   // still draining, not exited

    w.activeJobs.delete('rh-lp612');
    await job.finish();
    await jest.advanceTimersByTimeAsync(1_000);
    await done;
    expect(settled).toBe(true);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('still releases a non-lp612 job at the 30s deadline while the lp612 one keeps draining', async () => {
    const w = new SQSCoachingWorker('w3');
    const lp = pendingJob();
    const coach = pendingJob();
    w.activeJobs.set('rh-lp612', { promise: lp.promise, sourceQueue: 'main', jobType: 'lp612_author' });
    w.activeJobs.set('rh-analysis', { promise: coach.promise, sourceQueue: 'main', jobType: 'analysis' });

    const done = w.shutdown();
    await jest.advanceTimersByTimeAsync(31_000);

    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith('rh-analysis', 'main');

    w.activeJobs.delete('rh-lp612');
    w.activeJobs.delete('rh-analysis');
    await lp.finish(); await coach.finish();
    await jest.advanceTimersByTimeAsync(1_000);
    await done;
  });

  it('releases the lp612 message at the FINAL drain deadline so the handover is immediate', async () => {
    process.env.LP612_DRAIN_TIMEOUT_MS = '120000';
    jest.resetModules();
    ({ SQSCoachingWorker } = require('../../bot/workers/sqs-worker'));

    const w = new SQSCoachingWorker('w4');
    const job = pendingJob();
    w.activeJobs.set('rh-lp612', { promise: job.promise, sourceQueue: 'main', jobType: 'lp612_author' });

    const done = w.shutdown();
    await jest.advanceTimersByTimeAsync(31_000);
    expect(mockRelease).not.toHaveBeenCalled();          // NOT at the coaching deadline

    await jest.advanceTimersByTimeAsync(120_000 + 1_000); // at the lp612 deadline
    await done;
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith('rh-lp612', 'main');
  });

  it('records jobType on the activeJobs entry — without it the drain cannot tell the classes apart', async () => {
    const w = new SQSCoachingWorker('w5');
    // processJob is the real dispatcher; drive it with a job it will fail fast on, then read the map.
    const spy = jest.spyOn(w, 'executeJob').mockImplementation(() => new Promise(() => {}));
    w.processJob({
      receiptHandle: 'rh-1',
      sourceQueue: 'main',
      body: { sessionId: 's1', jobType: 'lp612_author', payload: {} },
    });
    const entry = w.activeJobs.get('rh-1');
    expect(entry).toBeDefined();
    expect(entry.jobType).toBe('lp612_author');
    spy.mockRestore();
  });
});
