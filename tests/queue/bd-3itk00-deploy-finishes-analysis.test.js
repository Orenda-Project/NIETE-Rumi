/**
 * bd-3itk00 — a worker deploy finishes the analyses it holds instead of handing them back at 30 s.
 *
 * Production, 24 Nov: a deploy sent SIGTERM to every sqs-worker replica. Railway gives this service 660 s
 * to drain, but shutdown() waited only GRACEFUL_SHUTDOWN_TIMEOUT_MS (30 s) for coaching jobs and then
 * handed every one back to SQS. One replica held three, two of them analyses: one had its model reply
 * 0.1 s before the hand-back, the other had already saved its analysis and was in the hand-off. Both ran
 * again from zero on another replica (a second model call each, ~2 more minutes). Analysis takes p50 150 s,
 * p95 231 s, p99 275 s (14 days, 4,399 jobs), so the 30 s window can only ever cut one off.
 *
 * Now:
 *   - an `analysis` job is finished on shutdown, like an lp612 lesson, up to its own deadline
 *     (ANALYSIS_DRAIN_TIMEOUT_MS, default 8 min: 30 s + 480 s fits Railway's 660 s);
 *   - a poll that returns after SIGTERM hands its messages straight back and starts none of them;
 *   - a job that fails with `retryable` (a connection cut mid-call) goes straight back to the queue for
 *     another replica: the row is not marked failed;
 *   - shutdown raises the shared flag the job code reads (job-interruption.isShuttingDown()).
 *
 * The REAL SQSCoachingWorker, with only SQS, the logger and the coaching service doubled.
 */

const mockRelease = jest.fn(() => Promise.resolve());
const mockComplete = jest.fn(() => Promise.resolve());
const mockReceive = jest.fn(() => Promise.resolve([]));
const mockProcessAnalysis = jest.fn(() => Promise.resolve());

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  releaseInFlightMessage: (...a) => mockRelease(...a),
  receiveJobs: (...a) => mockReceive(...a),
  receiveVideoJobs: jest.fn(() => Promise.resolve([])),
  receiveQuizJobs: jest.fn(() => Promise.resolve([])),
  completeJob: (...a) => mockComplete(...a),
  deleteJob: jest.fn(() => Promise.resolve()),
  extendJobTimeout: jest.fn(() => Promise.resolve()),
}));
// The session-owner lookup a coaching job runs first (cost attribution only): answer at once, no network.
jest.mock('../../bot/shared/config/supabase', () => {
  const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: null, error: null }) };
  return { from: () => b };
});
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({
  processAnalysis: (...a) => mockProcessAnalysis(...a),
}));

let SQSCoachingWorker;
let Interruption;

function pendingJob() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, finish: () => { resolve(); return promise; } };
}

function load() {
  jest.resetModules();
  ({ SQSCoachingWorker } = require('../../bot/workers/sqs-worker'));
  Interruption = require('../../bot/shared/utils/job-interruption');
}

beforeEach(() => {
  jest.useFakeTimers();
  [mockRelease, mockComplete, mockReceive, mockProcessAnalysis].forEach((m) => m.mockClear());
  mockReceive.mockImplementation(() => Promise.resolve([]));
  mockProcessAnalysis.mockImplementation(() => Promise.resolve());
  process.env.SQS_QUEUE_URL = 'https://sqs/main';
  delete process.env.SQS_VIDEO_QUEUE_URL;
  delete process.env.SQS_QUIZ_QUEUE_URL;
  delete process.env.WORKER_QUEUES;
  delete process.env.ANALYSIS_DRAIN_TIMEOUT_MS;
  delete process.env.LP612_DRAIN_TIMEOUT_MS;
  load();
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.ANALYSIS_DRAIN_TIMEOUT_MS;
});

describe('bd-3itk00 — shutdown finishes an analysis instead of handing it back', () => {
  it('does NOT release an in-flight analysis at the 30 s coaching deadline; waits for it, then releases nothing', async () => {
    const w = new SQSCoachingWorker('w1');
    const job = pendingJob();
    w.activeJobs.set('rh-analysis', { promise: job.promise, sourceQueue: 'main', jobType: 'analysis' });

    let settled = false;
    const done = w.shutdown().then(() => { settled = true; });
    await jest.advanceTimersByTimeAsync(120_000);       // 2 minutes into the drain: a p50 analysis
    expect(mockRelease).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    w.activeJobs.delete('rh-analysis');
    await job.finish();
    await jest.advanceTimersByTimeAsync(1_000);
    await done;
    expect(settled).toBe(true);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('hands an analysis back at ITS deadline (default 8 min), so a stuck one never outlives the platform window', async () => {
    const w = new SQSCoachingWorker('w2');
    const job = pendingJob();
    w.activeJobs.set('rh-analysis', { promise: job.promise, sourceQueue: 'main', jobType: 'analysis' });

    const done = w.shutdown();
    await jest.advanceTimersByTimeAsync(30_000 + 479_000);
    expect(mockRelease).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2_000);
    await done;
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith('rh-analysis', 'main');
  });

  it('the analysis deadline is tunable (ANALYSIS_DRAIN_TIMEOUT_MS) and capped to fit the 660 s platform window', () => {
    expect(SQSCoachingWorker.drainDeadlineMs('analysis')).toBe(480_000);
    process.env.ANALYSIS_DRAIN_TIMEOUT_MS = '60000';
    expect(SQSCoachingWorker.drainDeadlineMs('analysis')).toBe(60_000);
    process.env.ANALYSIS_DRAIN_TIMEOUT_MS = '3600000';
    expect(SQSCoachingWorker.drainDeadlineMs('analysis')).toBe(600_000);
    expect(SQSCoachingWorker.drainDeadlineMs('lp612_author')).toBe(600_000);
    expect(SQSCoachingWorker.drainDeadlineMs('transcription')).toBe(0);
  });

  it('a short job beside it is still handed back at 30 s, as before', async () => {
    const w = new SQSCoachingWorker('w3');
    const analysis = pendingJob();
    const transcription = pendingJob();
    w.activeJobs.set('rh-analysis', { promise: analysis.promise, sourceQueue: 'main', jobType: 'analysis' });
    w.activeJobs.set('rh-tx', { promise: transcription.promise, sourceQueue: 'main', jobType: 'transcription' });

    const done = w.shutdown();
    await jest.advanceTimersByTimeAsync(31_000);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith('rh-tx', 'main');

    w.activeJobs.delete('rh-analysis'); w.activeJobs.delete('rh-tx');
    await analysis.finish(); await transcription.finish();
    await jest.advanceTimersByTimeAsync(1_000);
    await done;
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('raises the shared shutting-down flag the job code reads', async () => {
    const w = new SQSCoachingWorker('w4');
    expect(Interruption.isShuttingDown()).toBe(false);
    await w.shutdown();
    expect(Interruption.isShuttingDown()).toBe(true);
  });
});

describe('bd-3itk00 — a shutting-down replica starts nothing new', () => {
  it('a poll that returns after SIGTERM hands its messages straight back and starts none of them', async () => {
    const w = new SQSCoachingWorker('w5');
    const executed = jest.spyOn(w, 'executeJob');
    mockReceive.mockImplementationOnce(async () => {
      w.isShuttingDown = true;            // SIGTERM lands while the 20 s long poll is open
      return [{ messageId: 'm-late', receiptHandle: 'rh-late', body: { sessionId: 's9', jobType: 'analysis', payload: {} } }];
    });

    await w.processNextBatch(3);

    expect(executed).not.toHaveBeenCalled();
    expect(w.activeJobs.size).toBe(0);
    expect(mockRelease).toHaveBeenCalledWith('rh-late', 'main');
  });
});

describe('bd-3itk00 — a retryable failure goes straight back to the queue', () => {
  async function runOne(w, error, extra = {}) {
    mockProcessAnalysis.mockImplementationOnce(() => Promise.reject(error));
    const failure = jest.spyOn(w, 'handleJobFailure');
    w.processJob({
      messageId: 'm-1', receiptHandle: 'rh-1', receiveCount: 1,
      body: { sessionId: 's1', jobType: 'analysis', payload: { from: '92300' } },
      ...extra,
    });
    await w.activeJobs.get('rh-1').promise;
    return failure;
  }

  it('releases the message for another replica now, and does not mark the session failed', async () => {
    const w = new SQSCoachingWorker('w6');
    const err = Object.assign(new TypeError('terminated'), { retryable: true, retryReason: 'transport' });
    const failure = await runOne(w, err);

    expect(mockRelease).toHaveBeenCalledWith('rh-1', 'main');
    expect(failure).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(w.stats.messagesRequeued).toBe(1);
  });

  it('an ordinary failure is handled exactly as before (row failed, message left to SQS)', async () => {
    const w = new SQSCoachingWorker('w7');
    const failure = await runOne(w, new Error('JSON parsing failed'));
    expect(failure).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('hands processAnalysis the message id and how many times SQS has delivered it', async () => {
    const w = new SQSCoachingWorker('w8');
    w.processJob({
      messageId: 'm-2', receiptHandle: 'rh-2', receiveCount: 2,
      body: { sessionId: 's2', jobType: 'analysis', payload: { from: '92300' } },
    });
    await w.activeJobs.get('rh-2').promise;
    expect(mockProcessAnalysis).toHaveBeenCalledWith('s2', { from: '92300' }, { messageId: 'm-2', receiveCount: 2 });
  });
});
