/**
 * The Challenge's child-voice orphan sweep is scheduled by the worker — on the replicas that poll the main
 * queue, hourly, with a first pass after boot — and nowhere else. The sweep itself (what is listed, what is
 * deleted, what is logged) runs for real in tests/quiz/web-quiz/web-quiz-challenge-record.test.js; here the
 * challenge module is a boundary (its return value is not what is asserted: the scheduling is).
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
jest.mock('../../shared/services/quiz/web-quiz-challenge', () => ({ sweepOrphans: jest.fn(async () => ({ listed: 2, deleted: 1, failed: 0 })) }));
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

const { scheduleChallengeVoiceSweep, challengeVoiceSweepEnabled } = require('../../workers/sqs-worker');
const { sweepOrphans } = require('../../shared/services/quiz/web-quiz-challenge');
const { logToFile } = require('../../shared/utils/logger');

const ORIGINAL = { q: process.env.WORKER_QUEUES, s: process.env.WEB_QUIZ_VOICE_SWEEP };
afterEach(() => {
  if (ORIGINAL.q === undefined) delete process.env.WORKER_QUEUES; else process.env.WORKER_QUEUES = ORIGINAL.q;
  if (ORIGINAL.s === undefined) delete process.env.WEB_QUIZ_VOICE_SWEEP; else process.env.WEB_QUIZ_VOICE_SWEEP = ORIGINAL.s;
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

test('a main-queue replica schedules the sweep hourly with a first pass 3 minutes after boot; a tick sweeps once and logs counts', async () => {
  process.env.WORKER_QUEUES = 'main,quiz';
  delete process.env.WEB_QUIZ_VOICE_SWEEP;
  const t = fakeTimers();
  const out = scheduleChallengeVoiceSweep({ worker: { isShuttingDown: false }, ...t });
  expect(out).not.toBeNull();
  expect(t.calls.intervals).toEqual([{ fn: expect.any(Function), ms: 60 * 60 * 1000 }]);
  expect(t.calls.timeouts).toEqual([{ fn: expect.any(Function), ms: 3 * 60 * 1000 }]);
  await t.calls.intervals[0].fn();
  expect(sweepOrphans).toHaveBeenCalledTimes(1);
  expect(logToFile).toHaveBeenCalledWith('🧹 Challenge voice orphan sweep', { listed: 2, deleted: 1, failed: 0 });
});

test('a video-only replica, or WEB_QUIZ_VOICE_SWEEP=off, schedules nothing and never sweeps', () => {
  process.env.WORKER_QUEUES = 'video';
  const t = fakeTimers();
  expect(scheduleChallengeVoiceSweep(t)).toBeNull();
  process.env.WORKER_QUEUES = 'main';
  process.env.WEB_QUIZ_VOICE_SWEEP = 'off';
  expect(challengeVoiceSweepEnabled()).toBe(false);
  expect(scheduleChallengeVoiceSweep(t)).toBeNull();
  expect(t.calls.intervals).toEqual([]);
  expect(sweepOrphans).not.toHaveBeenCalled();
});

test('unset WORKER_QUEUES (every queue, today\'s default) sweeps; a tick during shutdown does nothing; a failing sweep is logged, never thrown', async () => {
  delete process.env.WORKER_QUEUES;
  delete process.env.WEB_QUIZ_VOICE_SWEEP;
  const w = { isShuttingDown: true };
  const t = fakeTimers();
  const out = scheduleChallengeVoiceSweep({ worker: w, ...t });
  await out.tick();
  expect(sweepOrphans).not.toHaveBeenCalled();
  w.isShuttingDown = false;
  sweepOrphans.mockRejectedValueOnce(new Error('bucket down'));
  await expect(out.tick()).resolves.toBeUndefined();
  expect(logToFile).toHaveBeenCalledWith('Error in challenge voice orphan sweep (non-fatal)', { error: 'bucket down' });
});
