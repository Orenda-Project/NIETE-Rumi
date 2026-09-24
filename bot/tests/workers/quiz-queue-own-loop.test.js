'use strict';
/**
 * The quiz queue gets its own poll loop on a replica that also polls `main`.
 *
 * Before: processNextBatch() gave the quiz queue ONE slot per poll and waited on
 * Promise.all with the main queue's 20-second long poll. With `main` idle, each
 * replica took one quiz message per ~20 s — 10 replicas = ~1,800/h, the flat
 * ceiling production shows every hour of the day — and every quiz job (including
 * the one a teacher just tapped "yes" for) sat received-but-unstarted until the
 * main poll returned: the 19-second median queue wait.
 *
 * Here the main long poll is 300 ms (standing in for 20 s) and the quiz queue
 * holds a backlog. The real start() loop runs; only the SQS client (network
 * boundary) and the per-job work (executeJob, stubbed to a 10 ms job) are faked.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(), extractReflectiveCorpus: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(), generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));
jest.mock('../../shared/services/queue', () => ({
  receiveJobs: jest.fn(),
  receiveVideoJobs: jest.fn(),
  receiveQuizJobs: jest.fn(),
  completeJob: jest.fn().mockResolvedValue(true),
  completeVideoJob: jest.fn().mockResolvedValue(true),
  completeQuizJob: jest.fn().mockResolvedValue(true),
  releaseJob: jest.fn().mockResolvedValue(true),
  extendJobTimeout: jest.fn().mockResolvedValue(true),
  extendQuizJobTimeout: jest.fn().mockResolvedValue(true),
}));

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

const SQS = require('../../shared/services/queue');
const { SQSCoachingWorker } = require('../../workers/sqs-worker');

const MAIN_LONG_POLL_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saved = {};

function quizMsg(i) {
  return { receiptHandle: `rh-${i}`, messageId: `m-${i}`, body: { jobType: 'quiz_expire', groupId: `q-${i}`, payload: {} } };
}

/** Run a worker's real start() loop against a quiz backlog for `ms`, then stop it. */
async function drive({ backlog, ms }) {
  let next = 0;
  const started = [];
  SQS.receiveJobs.mockImplementation(async () => { await sleep(MAIN_LONG_POLL_MS); return []; });
  SQS.receiveQuizJobs.mockImplementation(async (n) => {
    await sleep(5);
    const out = [];
    while (out.length < n && next < backlog) out.push(quizMsg(next++));
    if (!out.length) await sleep(MAIN_LONG_POLL_MS);   // an empty long poll waits, like SQS
    return out;
  });
  const w = new SQSCoachingWorker('test-worker');
  const t0 = Date.now();
  w.executeJob = jest.fn(async (_s, jobType, _p, _rh, sourceQueue) => {
    started.push({ at: Date.now() - t0, jobType, sourceQueue });
    await sleep(10);
  });
  const run = w.start();
  await sleep(ms);
  w.isShuttingDown = true;
  await run;
  return { started, w };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ['WORKER_QUEUES', 'SQS_QUIZ_QUEUE_URL', 'SQS_VIDEO_QUEUE_URL', 'QUIZ_QUEUE_OWN_LOOP', 'QUIZ_QUEUE_CONCURRENCY']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.WORKER_QUEUES = 'main,quiz';
  process.env.SQS_QUIZ_QUEUE_URL = 'https://sqs.example/quiz';
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('quiz queue — its own poll loop beside main', () => {
  test('a quiz job starts at once, not after the main queue\'s long poll returns', async () => {
    const { started } = await drive({ backlog: 1, ms: 250 });
    expect(started.length).toBe(1);
    expect(started[0].sourceQueue).toBe('quiz');
    expect(started[0].at).toBeLessThan(MAIN_LONG_POLL_MS / 2);
  });

  test('a backlog drains at the quiz loop\'s rate, not one message per main long poll', async () => {
    // Old loop: ~1 quiz message per (300 ms main poll + 100 ms interval) ≈ 3 in 1.2 s.
    const { started } = await drive({ backlog: 60, ms: 1200 });
    expect(started.filter((s) => s.sourceQueue === 'quiz').length).toBeGreaterThanOrEqual(40);
  });

  test('the quiz loop keeps to its own slot budget (QUIZ_QUEUE_CONCURRENCY)', async () => {
    process.env.QUIZ_QUEUE_CONCURRENCY = '2';
    await drive({ backlog: 30, ms: 400 });
    for (const [n] of SQS.receiveQuizJobs.mock.calls) expect(n).toBeLessThanOrEqual(2);
  });

  test('default budget is 6 quiz slots per replica', async () => {
    await drive({ backlog: 30, ms: 200 });
    expect(SQS.receiveQuizJobs.mock.calls[0][0]).toBe(6);
  });

  test('the main poll keeps its whole budget and no longer polls the quiz queue', async () => {
    await drive({ backlog: 0, ms: 350 });
    const quizPolls = SQS.receiveQuizJobs.mock.calls.length;
    expect(SQS.receiveJobs).toHaveBeenCalled();
    // SQS_WORKER_CONCURRENCY defaults to 3: main used to get 3 - 1 = 2 when quiz shared the poll.
    for (const [n] of SQS.receiveJobs.mock.calls) expect(n).toBe(3);
    expect(quizPolls).toBeGreaterThan(0);   // polled by its own loop
  });

  test.each(['off', 'false', '0'])('QUIZ_QUEUE_OWN_LOOP=%s → the combined poll, one quiz slot, as before', async (v) => {
    process.env.QUIZ_QUEUE_OWN_LOOP = v;
    const { started } = await drive({ backlog: 60, ms: 1200 });
    for (const [n] of SQS.receiveQuizJobs.mock.calls) expect(n).toBe(1);
    for (const [n] of SQS.receiveJobs.mock.calls) expect(n).toBe(2);
    expect(started.length).toBeLessThanOrEqual(5);
  });

  test('a quiz-only replica is unchanged: one loop, the whole budget to quiz', async () => {
    process.env.WORKER_QUEUES = 'quiz';
    await drive({ backlog: 0, ms: 350 });
    expect(SQS.receiveJobs).not.toHaveBeenCalled();
    expect(SQS.receiveQuizJobs.mock.calls[0][0]).toBe(3);
  });
});
