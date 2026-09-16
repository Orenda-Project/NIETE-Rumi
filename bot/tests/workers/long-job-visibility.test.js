/**
 * The two long coaching jobs must keep their SQS message invisible while they run.
 *
 * `analysis` was the only long-running job in executeJob() that never extended its
 * visibility window, so a run past the queue's 900s window was redelivered and
 * restarted from zero: the teacher saw "Step 1/5 Transcribing" again, was told
 * "Long Lesson Detected" twice, and paid for a second analysis LLM call.
 *
 * `transcription` had an extension, but behind `payload.duration > 600` — and NO
 * producer sets `duration`; all five pass `{ from, audioId }`. The branch was dead
 * and every transcription lived on the bare window.
 *
 * These tests drive the REAL executeJob through the REAL queue service and assert at
 * the AWS boundary (`sqs.changeMessageVisibility`), which is the only place that
 * proves the message was actually kept in flight. Asserting on a spied
 * extendJobTimeout would pass against a call that never reaches SQS.
 */

const mockExtend = jest.fn(() => ({ promise: () => Promise.resolve({}) }));

jest.mock('aws-sdk', () => {
  const changeMessageVisibility = mockExtend;
  class SQS {
    constructor() {
      this.changeMessageVisibility = changeMessageVisibility;
      this.sendMessage = jest.fn(() => ({ promise: () => Promise.resolve({ MessageId: 'm' }) }));
      this.receiveMessage = jest.fn(() => ({ promise: () => Promise.resolve({ Messages: [] }) }));
      this.deleteMessage = jest.fn(() => ({ promise: () => Promise.resolve({}) }));
      this.getQueueAttributes = jest.fn(() => ({ promise: () => Promise.resolve({ Attributes: {} }) }));
      this.purgeQueue = jest.fn(() => ({ promise: () => Promise.resolve({}) }));
    }
  }
  return { config: { update: jest.fn() }, SQS };
});

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(), extractReflectiveCorpus: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(), generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));

// The two job bodies are stubbed so the test measures visibility, not pedagogy.
// Each resolves only when the test lets it, so a heartbeat has time to tick.
const mockProcessTranscription = jest.fn(() => Promise.resolve());
const mockProcessAnalysis = jest.fn(() => Promise.resolve());
jest.mock('../../shared/services/coaching-orchestrator.service', () => ({
  processTranscription: (...a) => mockProcessTranscription(...a),
  processAnalysis: (...a) => mockProcessAnalysis(...a),
  generateReport: jest.fn(),
}));

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';
process.env.SQS_QUEUE_URL = process.env.SQS_QUEUE_URL
  || 'https://sqs.us-east-1.amazonaws.com/000000000000/test-queue.fifo';

const { SQSCoachingWorker } = require('../../workers/sqs-worker');

const RECEIPT = 'receipt-handle-under-test';
// What every live producer actually sends. No `duration` — that is the defect.
const PAYLOAD = { from: '923001234567', audioId: 'wamid.audio' };

const visibilityCalls = () => mockExtend.mock.calls.map((c) => c[0]);

describe('long coaching jobs keep their SQS message in flight', () => {
  let worker;
  beforeEach(() => {
    jest.clearAllMocks();
    worker = new SQSCoachingWorker('test-worker');
  });

  test('analysis extends visibility at least once', async () => {
    await worker.executeJob('sess-analysis', 'analysis', PAYLOAD, RECEIPT, 'main');

    const calls = visibilityCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].ReceiptHandle).toBe(RECEIPT);
    expect(calls[0].VisibilityTimeout).toBeGreaterThanOrEqual(900);
  });

  test('transcription extends visibility on the payload every producer sends (no duration)', async () => {
    expect(PAYLOAD.duration).toBeUndefined();
    await worker.executeJob('sess-transcribe', 'transcription', PAYLOAD, RECEIPT, 'main');

    const calls = visibilityCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].ReceiptHandle).toBe(RECEIPT);
    expect(calls[0].VisibilityTimeout).toBeGreaterThanOrEqual(1200);
  });

  test('a job that runs past the interval keeps being re-extended, and stops at settle', async () => {
    jest.useFakeTimers();
    let release;
    mockProcessAnalysis.mockImplementationOnce(() => new Promise((res) => { release = res; }));

    const running = worker.executeJob('sess-slow', 'analysis', PAYLOAD, RECEIPT, 'main');
    // Let the up-front extension's promise chain settle before advancing the clock.
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(3 * 60 * 1000 + 1000);
    const duringRun = visibilityCalls().length;
    expect(duringRun).toBeGreaterThanOrEqual(3);

    release();
    await running;

    // The heartbeat must be stopped in a finally, or it keeps a finished job's
    // message invisible and starves everything queued behind it.
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(visibilityCalls().length).toBe(duringRun);
    jest.useRealTimers();
  });

  test('the heartbeat is stopped even when the job throws', async () => {
    jest.useFakeTimers();
    mockProcessAnalysis.mockImplementationOnce(() => Promise.reject(new Error('analysis blew up')));

    await expect(
      worker.executeJob('sess-fail', 'analysis', PAYLOAD, RECEIPT, 'main'),
    ).rejects.toThrow('analysis blew up');

    const afterThrow = visibilityCalls().length;
    expect(afterThrow).toBeGreaterThan(0);   // it did start; the point is that it stopped
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(visibilityCalls().length).toBe(afterThrow);
    jest.useRealTimers();
  });
});
