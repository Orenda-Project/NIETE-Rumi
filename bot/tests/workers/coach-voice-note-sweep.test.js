/**
 * bd-v0toag.67: the 30-day voice-note sweep is scheduled by the worker — on the replicas that poll the main
 * queue, daily, with a first pass after boot (Class P: this service redeploys often and each restart resets
 * an interval) — and nowhere else. The sweep itself runs for real in
 * tests/services/coach-voice-note-retention.test.js; here the retention module is a boundary (its return
 * value is not what is asserted: the scheduling is). Same shape as challenge-voice-sweep.test.js.
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
jest.mock('../../shared/services/coach-voice-note-retention.service', () => ({
  sweepExpiredVoiceNotes: jest.fn(async () => ({ checked: 2, deleted: 1, failed: 1 })),
}));
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

const { scheduleCoachVoiceNoteSweep, schedulePeriodicChecks } = require('../../workers/sqs-worker');
const { sweepExpiredVoiceNotes } = require('../../shared/services/coach-voice-note-retention.service');
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

test('a main-queue replica schedules the sweep daily with a first pass 4 minutes after boot; a tick sweeps 30-day notes once and logs counts', async () => {
  process.env.WORKER_QUEUES = 'main,quiz';
  const t = fakeTimers();
  const out = scheduleCoachVoiceNoteSweep({ worker: { isShuttingDown: false }, ...t });
  expect(out).not.toBeNull();
  expect(t.calls.intervals).toEqual([{ fn: expect.any(Function), ms: 24 * 60 * 60 * 1000 }]);
  expect(t.calls.timeouts).toEqual([{ fn: expect.any(Function), ms: 4 * 60 * 1000 }]);
  await t.calls.timeouts[0].fn();
  expect(sweepExpiredVoiceNotes).toHaveBeenCalledTimes(1);
  expect(sweepExpiredVoiceNotes).toHaveBeenCalledWith({ maxAgeDays: 30 });
  expect(logToFile).toHaveBeenCalledWith('🧹 Coach voice-note 30-day sweep', { checked: 2, deleted: 1, failed: 1 });
});

test('a video-only replica schedules nothing, says so, and never sweeps', () => {
  process.env.WORKER_QUEUES = 'video';
  const t = fakeTimers();
  expect(scheduleCoachVoiceNoteSweep(t)).toBeNull();
  expect(t.calls.intervals).toEqual([]);
  expect(logToFile).toHaveBeenCalledWith('Coach voice-note sweep not scheduled on this replica', { reason: 'no main queue' });
  expect(sweepExpiredVoiceNotes).not.toHaveBeenCalled();
});

test('a tick during shutdown does nothing and says so; a failing sweep is logged, never thrown', async () => {
  delete process.env.WORKER_QUEUES;
  const w = { isShuttingDown: true };
  const out = scheduleCoachVoiceNoteSweep({ worker: w, ...fakeTimers() });
  await out.tick();
  expect(sweepExpiredVoiceNotes).not.toHaveBeenCalled();
  expect(logToFile).toHaveBeenCalledWith('Coach voice-note sweep tick', { outcome: 'skipped', reason: 'shutting_down' });
  w.isShuttingDown = false;
  sweepExpiredVoiceNotes.mockRejectedValueOnce(new Error('bucket down'));
  await expect(out.tick()).resolves.toBeUndefined();
  expect(logToFile).toHaveBeenCalledWith('Error in coach voice-note sweep (non-fatal)', { error: 'bucket down' }, 'error');
});

test('the boot step schedules it: schedulePeriodicChecks on a main-queue replica logs the sweep as enabled', () => {
  process.env.WORKER_QUEUES = 'main';
  jest.useFakeTimers();
  try {
    schedulePeriodicChecks({ worker: { isShuttingDown: false } });
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('Coach voice-note 30-day sweep enabled'));
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
