'use strict';
/**
 * The answer-key review flag is scheduled by the worker — on the replicas that poll the main queue, hourly, with a
 * first pass after boot (Class P: this service redeploys often and each restart resets an interval) — and nowhere
 * else. The run itself is tested in quiz-key-review.test.js; here it is the injected boundary. Same shape as
 * tests/workers/coach-voice-note-sweep.test.js.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(), extractReflectiveCorpus: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(), generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));
jest.mock('@anthropic-ai/sdk', () => {
  class Anthropic { constructor() { this.messages = { create: jest.fn() }; } }
  Anthropic.default = Anthropic;
  Anthropic.APIError = class APIError extends Error {};
  return Anthropic;
}, { virtual: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

const { scheduleQuizKeyReview, FIRST_MS, TICK_MS } = require('../../workers/quiz-key-review-schedule');
const { schedulePeriodicChecks } = require('../../workers/sqs-worker');
const { logToFile } = require('../../shared/utils/logger');

const ORIGINAL = process.env.WORKER_QUEUES;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.WORKER_QUEUES; else process.env.WORKER_QUEUES = ORIGINAL;
  jest.clearAllMocks();
});

const fakeTimers = () => {
  const calls = { intervals: [], timeouts: [] };
  return {
    calls,
    setIntervalFn: (fn, ms) => { calls.intervals.push({ fn, ms }); return { unref() {} }; },
    setTimeoutFn: (fn, ms) => { calls.timeouts.push({ fn, ms }); return { unref() {} }; },
  };
};

test('a main-queue replica ticks hourly from a first pass 5 minutes after boot; a tick runs the flag', async () => {
  const t = fakeTimers();
  const run = jest.fn(async () => ({ outcome: 'not_due' }));
  const out = scheduleQuizKeyReview({ worker: { isShuttingDown: false }, hasMainQueue: true, run, ...t });
  expect(out).not.toBeNull();
  expect(t.calls.timeouts).toEqual([{ fn: expect.any(Function), ms: FIRST_MS }]);
  expect(FIRST_MS).toBe(5 * 60 * 1000);
  await t.calls.timeouts[0].fn();
  expect(t.calls.intervals).toEqual([{ fn: expect.any(Function), ms: TICK_MS }]);
  expect(TICK_MS).toBe(60 * 60 * 1000);
  expect(run).toHaveBeenCalledTimes(1);
});

test('no main queue: not scheduled; a throwing run never escapes a tick; shutting down skips the run', async () => {
  expect(scheduleQuizKeyReview({ hasMainQueue: false, ...fakeTimers() })).toBeNull();
  const run = jest.fn(async () => { throw new Error('replica down'); });
  const w = { isShuttingDown: false };
  const out = scheduleQuizKeyReview({ worker: w, hasMainQueue: true, run, ...fakeTimers() });
  await expect(out.tick()).resolves.toBeNull();
  expect(logToFile).toHaveBeenCalledWith('Error in the answer-key review flag (non-fatal)', { error: 'replica down' }, 'error');
  w.isShuttingDown = true;
  run.mockClear();
  await out.tick();
  expect(run).not.toHaveBeenCalled();
});

test('the boot step schedules it: schedulePeriodicChecks on a main-queue replica logs the flag as scheduled', () => {
  process.env.WORKER_QUEUES = 'main';
  jest.useFakeTimers();
  try {
    schedulePeriodicChecks({ worker: { isShuttingDown: false } });
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('Answer-key review scheduled'));
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
