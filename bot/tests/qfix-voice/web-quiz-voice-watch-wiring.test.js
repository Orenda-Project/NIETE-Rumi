/**
 * The daily voice alarm has a caller: the worker's boot step schedules it on a main-queue replica (Class Q), alongside
 * the other periodic checks. Same shape as tests/workers/coach-voice-note-sweep.test.js (the boot step run for real;
 * model clients and the logger are boundaries).
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/gpt5-mini.service', () => ({ analyzePedagogy: jest.fn(), extractReflectiveCorpus: jest.fn() }));
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

const { schedulePeriodicChecks } = require('../../workers/sqs-worker');
const { logToFile } = require('../../shared/utils/logger');

const ORIGINAL = process.env.WORKER_QUEUES;
afterEach(() => { if (ORIGINAL === undefined) delete process.env.WORKER_QUEUES; else process.env.WORKER_QUEUES = ORIGINAL; jest.clearAllMocks(); });

test('schedulePeriodicChecks on a main-queue replica schedules the voice alarm', () => {
  process.env.WORKER_QUEUES = 'main';
  jest.useFakeTimers();
  try {
    schedulePeriodicChecks({ worker: { isShuttingDown: false } });
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('Web quiz voice alarm scheduled'));
  } finally { jest.clearAllTimers(); jest.useRealTimers(); }
});

test('a replica without the main queue does not', () => {
  process.env.WORKER_QUEUES = 'quiz';
  jest.useFakeTimers();
  try {
    schedulePeriodicChecks({ worker: { isShuttingDown: false } });
    expect(logToFile).not.toHaveBeenCalledWith(expect.stringContaining('Web quiz voice alarm scheduled'));
  } finally { jest.clearAllTimers(); jest.useRealTimers(); }
});
