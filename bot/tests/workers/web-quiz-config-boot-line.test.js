'use strict';
/**
 * Every worker logs web_quiz.config once at boot: the main+quiz worker and the
 * video worker run this same file, and the line is how a deploy shows they
 * agree on the quiz-audio bucket, the child-link host and the token secret.
 * The REAL `startWorker()` boots here (boundaries mocked as the lp_quiz_offer
 * wiring suite does them); the event logger is the observed boundary.
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
jest.mock('../../shared/services/monitoring/quiz-funnel-watch.service', () => ({
  run: jest.fn().mockResolvedValue({ skipped: 'disabled' }),
}));
jest.mock('../../shared/services/lp612-serving.service', () => ({
  reapStrandedRenders: jest.fn().mockResolvedValue(0),
}));

// The module under observation: the sweeper. Real in its own suite; a spy here.
const mockRunSweep = jest.fn().mockResolvedValue({ claimed: 0, sent: 0, skipped: 0, failed: 0, expired: 0 });
const mockRegister = jest.fn();
jest.mock('../../shared/services/nudges/teacher-nudges.sweeper', () => ({
  register: (...a) => mockRegister(...a),
  runSweep: (...a) => mockRunSweep(...a),
  isEnabled: () => ['true', '1', 'yes'].includes(String(process.env.TEACHER_NUDGES_ENABLED || '').trim().toLowerCase()),
}));

const mockEvent = jest.fn();
jest.mock('../../shared/utils/structured-logger', () => ({
  ...jest.requireActual('../../shared/utils/structured-logger'),
  logEvent: (...a) => mockEvent(...a),
}));

const mockLog = jest.fn();
jest.mock('../../shared/utils/logger', () => ({
  logToFile: (...a) => mockLog(...a),
  generateCorrelationId: () => 'test',
  runWithCorrelation: (_id, fn) => fn(),
}));

const MINUTE = 60 * 1000;
const ENV_KEYS = ['WORKER_QUEUES', 'TEACHER_NUDGES_ENABLED', 'TEACHER_NUDGES_SWEEP_MINUTES', 'WEB_QUIZ_AUDIO_BUCKET', 'WEB_QUIZ_BASE_URL', 'WEB_QUIZ_TOKEN_SECRET'];
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

describe('web_quiz.config at worker boot', () => {
  const lines = () => mockEvent.mock.calls.filter((c) => c[0] === 'web_quiz.config').map((c) => c[1]);

  test.each([[{}], [{ WORKER_QUEUES: 'video' }], [{ WORKER_QUEUES: 'main,quiz' }]])('%j: one line with the resolved names', async (env) => {
    await boot({ ...env, WEB_QUIZ_AUDIO_BUCKET: 'quiz-audio-x', WEB_QUIZ_BASE_URL: 'https://kids.example.test' });
    expect(lines()).toEqual([expect.objectContaining({ audioBucket: 'quiz-audio-x', childVoiceBucket: 'quiz-audio-x', baseHost: 'kids.example.test' })]);
    expect(['own', 'derived', 'none']).toContain(lines()[0].tokenSecret);
  });
});
