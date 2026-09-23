'use strict';
/**
 * The teacher-nudge core, the worker half — the teacher-nudge sweep's interval on
 * `bot/workers/sqs-worker.js`.
 *
 * This suite DRIVES THE REAL `startWorker()`. Everything it touches that reaches
 * a socket is mocked at its boundary (express, the SQS worker's own `start`, the
 * recovery services, the database); the wiring under test — the gate, the
 * interval, the 90-second first run — is the shipped code, and the proof is that
 * the sweeper's `runSweep` is actually called once the clock is advanced.
 *
 * A source-grep would pass on a `setInterval` that sits inside an `if` nobody
 * enters, which is the exact bug being guarded against:
 *
 *   THE TWO-SERVICE TRAP. `sqs-worker` and `sqs-worker-video` are two Railway services
 *   running THIS SAME FILE. An ungated interval means every tick is swept twice,
 *   for ever, by two services. The claim makes that harmless rather than
 *   double-sending — but "harmless because we win a race" is not a design. One
 *   owning worker class is, and `main` is it.
 *
 * And the flag: unset, the block is a complete no-op — nothing is registered,
 * nothing ticks, nothing is read.
 */

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

// `@anthropic-ai/sdk` is not installed in this worktree (nor in bot/node_modules on
// `sandbox`), and `llm-client.js` requires it at module scope, so ANY suite that loads the
// real sqs-worker dies at require — including the pre-existing
// debrief-retry-sweep glue suite under tests/workers/, which is red on clean sandbox for
// exactly this reason. Same remedy as tests/setup/migrate.test.js uses for supabase-js: a
// virtual mock. Nothing here calls the SDK.
jest.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    constructor() { this.messages = { create: jest.fn() }; }
  }
  Anthropic.default = Anthropic;
  Anthropic.APIError = class APIError extends Error {};
  return Anthropic;
}, { virtual: true });

// ── boundaries ───────────────────────────────────────────────────────────────
function thenable(result) {
  const b = {};
  for (const op of ['select', 'eq', 'neq', 'is', 'not', 'gte', 'lte', 'lt', 'gt', 'in', 'order', 'limit', 'update', 'insert']) {
    b[op] = () => b;
  }
  b.single = async () => result;
  b.maybeSingle = async () => result;
  b.then = (res, rej) => Promise.resolve(result).then(res, rej);
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: () => thenableRef() }));
// indirection so the factory above can reach the helper defined after the mock call
let thenableRef = () => thenable({ data: [], error: null });

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

// The health endpoint is a real socket; stub the framework, not the call site.
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
jest.mock('../../shared/services/conversation-resume.service', () => ({
  sweepAndOffer: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../shared/services/monitoring/prod-failure-digest.service', () => ({
  run: jest.fn().mockResolvedValue({ reported: false }),
}));
jest.mock('../../shared/services/lp612-serving.service', () => ({
  reapStrandedRenders: jest.fn().mockResolvedValue(0),
}));

// The module under observation: the sweeper. Real in its own suite; a spy here.
const mockRunSweep = jest.fn().mockResolvedValue({ claimed: 0, sent: 0, skipped: 0, failed: 0, expired: 0 });
jest.mock('../../shared/services/nudges/teacher-nudges.sweeper', () => ({
  register: jest.fn(),
  runSweep: (...a) => mockRunSweep(...a),
  isEnabled: () => ['true', '1', 'yes'].includes(String(process.env.TEACHER_NUDGES_ENABLED || '').trim().toLowerCase()),
}));

const mockLog = jest.fn();
jest.mock('../../shared/utils/logger', () => ({
  logToFile: (...a) => mockLog(...a),
  generateCorrelationId: () => 'test',
  runWithCorrelation: (_id, fn) => fn(),
}));

const MINUTE = 60 * 1000;
const ENV_KEYS = ['WORKER_QUEUES', 'TEACHER_NUDGES_ENABLED', 'TEACHER_NUDGES_SWEEP_MINUTES'];
const saved = {};

/** Boot the REAL startWorker() under a given environment, with fake timers running. */
async function boot(env = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  let mod;
  jest.isolateModules(() => { mod = require('../../workers/sqs-worker'); });
  // `start` is called on the module's own singleton, so capturing `this` here hands the
  // test the exact instance startWorker() closed over (it is not exported).
  jest.spyOn(mod.SQSCoachingWorker.prototype, 'start').mockImplementation(function () {
    mod.workerInstance = this;
    return Promise.resolve(undefined);
  });
  await mod.startWorker();
  return mod;
}

beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
beforeEach(() => {
  jest.clearAllMocks();
  mockRunSweep.mockResolvedValue({ claimed: 0, sent: 0, skipped: 0, failed: 0, expired: 0 });
  jest.useFakeTimers();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the teacher-nudge sweep interval on sqs-worker', () => {
  test('armed on the main queue: the first run lands 90 s after boot, then every 5 minutes', async () => {
    await boot({ TEACHER_NUDGES_ENABLED: 'true' });   // WORKER_QUEUES unset → all queues, incl. main

    expect(mockRunSweep).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(89 * 1000);
    expect(mockRunSweep).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2 * 1000);    // 91 s
    expect(mockRunSweep).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    expect(mockRunSweep).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    expect(mockRunSweep).toHaveBeenCalledTimes(3);
  });

  test('WORKER_QUEUES=main arms it explicitly', async () => {
    await boot({ TEACHER_NUDGES_ENABLED: 'true', WORKER_QUEUES: 'main,quiz' });
    await jest.advanceTimersByTimeAsync(91 * 1000);
    expect(mockRunSweep).toHaveBeenCalledTimes(1);
  });

  test('the video worker runs this same file and must NEVER sweep', async () => {
    await boot({ TEACHER_NUDGES_ENABLED: 'true', WORKER_QUEUES: 'video' });

    await jest.advanceTimersByTimeAsync(30 * MINUTE);
    expect(mockRunSweep).not.toHaveBeenCalled();
  });

  test('flag unset: nothing is registered and nothing ever ticks, on any queue', async () => {
    await boot({});                                   // no TEACHER_NUDGES_ENABLED
    await jest.advanceTimersByTimeAsync(30 * MINUTE);
    expect(mockRunSweep).not.toHaveBeenCalled();
  });

  test('flag explicitly false is the same as unset', async () => {
    await boot({ TEACHER_NUDGES_ENABLED: 'false' });
    await jest.advanceTimersByTimeAsync(30 * MINUTE);
    expect(mockRunSweep).not.toHaveBeenCalled();
  });

  test('TEACHER_NUDGES_SWEEP_MINUTES sets the interval', async () => {
    await boot({ TEACHER_NUDGES_ENABLED: 'true', TEACHER_NUDGES_SWEEP_MINUTES: '2' });
    await jest.advanceTimersByTimeAsync(91 * 1000);
    expect(mockRunSweep).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    expect(mockRunSweep).toHaveBeenCalledTimes(2);
  });

  test('a value below the one-minute floor is refused and the 5-minute default is used', async () => {
    await boot({ TEACHER_NUDGES_ENABLED: 'true', TEACHER_NUDGES_SWEEP_MINUTES: '0' });
    await jest.advanceTimersByTimeAsync(91 * 1000);
    expect(mockRunSweep).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    expect(mockRunSweep).toHaveBeenCalledTimes(1);     // not yet — the floor was not obeyed
    await jest.advanceTimersByTimeAsync(3 * MINUTE);
    expect(mockRunSweep).toHaveBeenCalledTimes(2);
  });

  test('a sweep that rejects is caught, logged at error level, and the next tick still fires', async () => {
    await boot({ TEACHER_NUDGES_ENABLED: 'true' });
    mockRunSweep.mockRejectedValueOnce(new Error('database is on fire'));

    await jest.advanceTimersByTimeAsync(91 * 1000);
    expect(mockRunSweep).toHaveBeenCalledTimes(1);
    expect(mockLog.mock.calls.filter(([, , level]) => level === 'error').length).toBeGreaterThan(0);

    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    expect(mockRunSweep).toHaveBeenCalledTimes(2);
  });

  test('a shutting-down worker does not start another sweep', async () => {
    const mod = await boot({ TEACHER_NUDGES_ENABLED: 'true' });
    await jest.advanceTimersByTimeAsync(91 * 1000);
    expect(mockRunSweep).toHaveBeenCalledTimes(1);

    // Drain is in progress; the interval must not hand the store more work.
    expect(mod.workerInstance).toBeInstanceOf(mod.SQSCoachingWorker);
    mod.workerInstance.isShuttingDown = true;
    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    expect(mockRunSweep).toHaveBeenCalledTimes(1);
  });

  test('the boot log says what was armed, so an unswept queue class is visible in the deploy log', async () => {
    await boot({ TEACHER_NUDGES_ENABLED: 'true', TEACHER_NUDGES_SWEEP_MINUTES: '3' });
    const line = mockLog.mock.calls.find(([msg]) => /teacher.nudge/i.test(String(msg)));
    expect(line).toBeTruthy();
    expect(line[1]).toEqual(expect.objectContaining({ everyMinutes: 3, firstRunSeconds: 90 }));
  });
});
