'use strict';
/**
 * The interrupted-task resume sweep's tick line must be able to say "deferred for
 * quiet hours".
 *
 * At night the sweep sends nothing and leaves each offer for the morning. A night
 * of those ticks offers nothing, closes nothing and fails nothing — so if the
 * worker only logs a tick that offered, expired, failed, was locked out or found
 * the teacher active, every deferring tick is silent, and a sweep holding forty
 * offers until 07:00 looks exactly like a sweep with nothing to do. (Same shape as
 * the lock-blocked case that was once missing from this condition.)
 *
 * This suite DRIVES THE REAL `startWorker()` and its 30-minute interval with fake
 * timers; everything that reaches a socket is mocked at its boundary, and the
 * resume service is a stub whose tally the test chooses — the condition under test
 * is the worker's, not the service's.
 */

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

// `llm-client.js` requires the SDK at module scope and it is not installed for the
// bot suites; nothing here calls it (same remedy as the teacher-nudge wiring suite).
jest.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    constructor() { this.messages = { create: jest.fn() }; }
  }
  Anthropic.default = Anthropic;
  Anthropic.APIError = class APIError extends Error {};
  return Anthropic;
}, { virtual: true });

// ── boundaries ───────────────────────────────────────────────────────────────
function mockThenable(result) {
  const b = {};
  for (const op of ['select', 'eq', 'neq', 'is', 'not', 'gte', 'lte', 'lt', 'gt', 'in', 'order', 'limit', 'update', 'insert']) {
    b[op] = () => b;
  }
  b.single = async () => result;
  b.maybeSingle = async () => result;
  b.then = (res, rej) => Promise.resolve(result).then(res, rej);
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: () => mockThenable({ data: [], error: null }) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn().mockResolvedValue(true), get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
  isAvailable: () => true,
}));
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveDebrief: jest.fn(), queueAnalysis: jest.fn(), queueReport: jest.fn(), queueJob: jest.fn(),
}));
jest.mock('../../shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(), extractReflectiveCorpus: jest.fn(), completeJson: jest.fn(),
}));
jest.mock('express', () => {
  const app = { get: jest.fn(), use: jest.fn(), post: jest.fn(), listen: jest.fn(() => ({ close: jest.fn() })) };
  const express = () => app;
  express.json = () => (_q, _s, next) => next && next();
  express.urlencoded = () => (_q, _s, next) => next && next();
  return express;
});
jest.mock('../../shared/services/lesson-plan-queue.service', () => ({
  getStaleRequests: jest.fn().mockResolvedValue([]), getRequest: jest.fn(),
  updateRequestStatus: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendButtons: jest.fn(),
}));
jest.mock('../../workers/exam-grading.worker', () => ({
  recoverStaleExamSessions: jest.fn().mockResolvedValue(undefined),
  processExamGrading: jest.fn(),
}));
jest.mock('../../shared/services/soniox-cleanup.service', () => ({
  runSonioxCleanup: jest.fn().mockResolvedValue({ deleted: 0 }),
}));
jest.mock('../../workers/stale-session.worker', () => ({
  runRecovery: jest.fn().mockResolvedValue({}),
  __thresholds: { reminderMs: 120000, autoCompleteMs: 720000, userActiveMs: 300000 },
}));
jest.mock('../../shared/services/quiz/video-quiz.service', () => ({
  sweepIgnoredOffers: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../shared/services/monitoring/prod-failure-digest.service', () => ({
  run: jest.fn().mockResolvedValue({ reported: false }),
}));
jest.mock('../../shared/services/lp612-serving.service', () => ({
  reapStrandedRenders: jest.fn().mockResolvedValue(0),
}));

// The collaborator whose tally drives the condition under test.
const mockSweepAndOffer = jest.fn();
jest.mock('../../shared/services/conversation-resume.service', () => ({
  sweepAndOffer: (...a) => mockSweepAndOffer(...a),
}));

const mockLog = jest.fn();
jest.mock('../../shared/utils/logger', () => ({
  logToFile: (...a) => mockLog(...a),
  generateCorrelationId: () => 'test',
  runWithCorrelation: (_id, fn) => fn(),
}));

const MINUTE = 60 * 1000;
const TICK_LINE = '🔄 Interrupted-task resume sweep';
const IDLE = Object.freeze({
  offered: 0, expired: 0, skipped: 0, failed: 0, skippedActive: 0, skippedLocked: false, deferredQuietHours: 0,
});
const savedNudges = process.env.TEACHER_NUDGES_ENABLED;

async function boot() {
  delete process.env.TEACHER_NUDGES_ENABLED;   // keep the other sweep out of the way
  let mod;
  jest.isolateModules(() => { mod = require('../../workers/sqs-worker'); });
  jest.spyOn(mod.SQSCoachingWorker.prototype, 'start').mockImplementation(() => Promise.resolve(undefined));
  await mod.startWorker();
  return mod;
}

const tickLines = () => mockLog.mock.calls.filter(([msg]) => msg === TICK_LINE);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});
afterAll(() => {
  if (savedNudges === undefined) delete process.env.TEACHER_NUDGES_ENABLED;
  else process.env.TEACHER_NUDGES_ENABLED = savedNudges;
});

describe('the resume sweep tick line on sqs-worker', () => {
  test('a tick that only deferred offers for quiet hours still logs, with the count', async () => {
    mockSweepAndOffer.mockResolvedValue({ ...IDLE, deferredQuietHours: 4 });
    await boot();

    await jest.advanceTimersByTimeAsync(30 * MINUTE);

    expect(mockSweepAndOffer).toHaveBeenCalledTimes(1);
    expect(tickLines()).toHaveLength(1);
    expect(tickLines()[0][1]).toEqual(expect.objectContaining({ deferredQuietHours: 4, offered: 0 }));
  });

  test('CONTROL: a tick with nothing to report stays silent', async () => {
    mockSweepAndOffer.mockResolvedValue({ ...IDLE });
    await boot();

    await jest.advanceTimersByTimeAsync(30 * MINUTE);

    expect(mockSweepAndOffer).toHaveBeenCalledTimes(1);
    expect(tickLines()).toHaveLength(0);
  });

  test('CONTROL: a tick that offered logs as before', async () => {
    mockSweepAndOffer.mockResolvedValue({ ...IDLE, offered: 2 });
    await boot();

    await jest.advanceTimersByTimeAsync(30 * MINUTE);

    expect(tickLines()).toHaveLength(1);
    expect(tickLines()[0][1]).toEqual(expect.objectContaining({ offered: 2, deferredQuietHours: 0 }));
  });
});
