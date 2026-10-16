/**
 * A paper's queue message stays invisible for as long as the paper is being made, and a deploy
 * finishes the paper instead of handing it back.
 *
 * The assessment job set one fixed 300 s window up front. A paper can need more (two attempts at
 * the model's 180 s timeout, an empty-reply retry, two renders), and when the window ran out the
 * message reached a second worker while the first was still writing: the same paper, paid twice.
 * It now runs under the same visibility heartbeat as transcription and analysis, and its up-front
 * window is the heartbeat's own 900 s, so the first minute is not the weak spot.
 *
 * A deploy used to wait 30 s and then hand every in-flight paper back to the queue, after which
 * the process exits and the run dies with it. The duplicate guard (orchestrator-duplicate-
 * delivery.test.js) correctly refuses to build a paper whose row was written moments ago, so a
 * handed-back paper would sit in `generating`. Papers now drain like lesson plans: the deploy
 * waits for them, under the heartbeat.
 *
 * Drives the REAL SQSCoachingWorker (executeJob and shutdown), doubling only the SQS boundary,
 * the logger and the orchestrator the case delegates to.
 */

const mockExtend = jest.fn(() => Promise.resolve());
const mockRelease = jest.fn(() => Promise.resolve());

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  releaseInFlightMessage: (...a) => mockRelease(...a),
  receiveJobs: jest.fn(() => Promise.resolve([])),
  deleteJob: jest.fn(() => Promise.resolve()),
  completeJob: jest.fn(() => Promise.resolve()),
  extendJobTimeout: (...a) => mockExtend(...a),
}));
let mockProcess;
jest.mock('../../bot/shared/services/assessment/assessment-orchestrator.service', () => ({
  process: (...a) => mockProcess(...a),
}));

async function flush(times = 10) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/** A paper still being made; finish() / fail() settle it. */
function pendingPaper() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, finish: (v) => { resolve(v); return promise; }, fail: (e) => { reject(e); return promise.catch(() => {}); } };
}

const PAYLOAD = { userId: 'teacher-1', requestId: 'req-1', grade: 5, subject: 'maths', deliver: 'none' };

let SQSCoachingWorker;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  mockExtend.mockReset();
  mockExtend.mockImplementation(() => Promise.resolve());
  mockRelease.mockClear();
  process.env.SQS_QUEUE_URL = 'https://sqs/main';
  delete process.env.LP612_DRAIN_TIMEOUT_MS;
  ({ SQSCoachingWorker } = require('../../bot/workers/sqs-worker'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('worker: assessment_generate visibility', () => {
  test('worker: assessment job runs under the heartbeat', async () => {
    const paper = pendingPaper();
    mockProcess = jest.fn(() => paper.promise);
    const w = new SQSCoachingWorker('w-hb-1');

    const run = w.executeJob('req-1', 'assessment_generate', PAYLOAD, 'receipt-1', 'main', {});
    await flush();
    expect(mockExtend).toHaveBeenCalledTimes(1);
    expect(mockExtend).toHaveBeenLastCalledWith('receipt-1', 900);
    expect(mockProcess).toHaveBeenCalledWith(PAYLOAD);

    // Four minutes in, still writing: the window has been topped up every minute.
    await jest.advanceTimersByTimeAsync(4 * 60 * 1000);
    await flush();
    expect(mockExtend.mock.calls.length).toBeGreaterThanOrEqual(5);
    mockExtend.mock.calls.forEach(([handle, seconds]) => {
      expect(handle).toBe('receipt-1');
      expect(seconds).toBe(900);
    });

    // Done: the heartbeat stops at once.
    paper.finish({ status: 'ready' });
    await run;
    const calls = mockExtend.mock.calls.length;
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    await flush();
    expect(mockExtend).toHaveBeenCalledTimes(calls);
  });

  test('the heartbeat stops when the paper fails, and the failure still reaches the worker', async () => {
    const paper = pendingPaper();
    mockProcess = jest.fn(() => paper.promise);
    const w = new SQSCoachingWorker('w-hb-2');

    const run = w.executeJob('req-1', 'assessment_generate', PAYLOAD, 'receipt-2', 'main', {});
    const settled = run.then(() => 'resolved', (e) => e.message);
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
    await paper.fail(new Error('render crashed'));
    await expect(settled).resolves.toBe('render crashed');

    const calls = mockExtend.mock.calls.length;
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    await flush();
    expect(mockExtend).toHaveBeenCalledTimes(calls);
  });

  test('a visibility blip does not abandon the paper', async () => {
    const paper = pendingPaper();
    mockProcess = jest.fn(() => paper.promise);
    mockExtend.mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => Promise.reject(new Error('throttled')));
    const w = new SQSCoachingWorker('w-hb-3');

    const run = w.executeJob('req-1', 'assessment_generate', PAYLOAD, 'receipt-3', 'main', {});
    await jest.advanceTimersByTimeAsync(3 * 60 * 1000);
    await flush();
    expect(mockExtend.mock.calls.length).toBeGreaterThanOrEqual(3);
    paper.finish({ status: 'ready' });
    await expect(run).resolves.toBeUndefined();
  });
});

describe('worker: a deploy and an in-flight paper', () => {
  test('a deploy finishes an in-flight paper instead of handing it back at 30 s', async () => {
    const w = new SQSCoachingWorker('w-drain-1');
    const paper = pendingPaper();
    w.activeJobs.set('rh-paper', { promise: paper.promise, sourceQueue: 'main', jobType: 'assessment_generate' });

    let settled = false;
    const done = w.shutdown().then(() => { settled = true; });
    await jest.advanceTimersByTimeAsync(90_000);
    expect(mockRelease).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    w.activeJobs.delete('rh-paper');
    await paper.finish();
    await jest.advanceTimersByTimeAsync(1_000);
    await done;
    expect(settled).toBe(true);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  test('a coaching analysis is still handed back at 30 s while a paper drains', async () => {
    const w = new SQSCoachingWorker('w-drain-2');
    const paper = pendingPaper();
    const analysis = pendingPaper();
    w.activeJobs.set('rh-paper', { promise: paper.promise, sourceQueue: 'main', jobType: 'assessment_generate' });
    w.activeJobs.set('rh-analysis', { promise: analysis.promise, sourceQueue: 'main', jobType: 'analysis' });

    const done = w.shutdown();
    await jest.advanceTimersByTimeAsync(31_000);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith('rh-analysis', 'main');

    w.activeJobs.delete('rh-paper');
    w.activeJobs.delete('rh-analysis');
    await paper.finish(); await analysis.finish();
    await jest.advanceTimersByTimeAsync(1_000);
    await done;
  });
});
