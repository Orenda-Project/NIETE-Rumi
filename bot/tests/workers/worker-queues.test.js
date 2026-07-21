/**
 * bd-2240 — WORKER_QUEUES queue isolation (ported from main-bot bd-1372).
 *
 * WHY: NIETE ran ONE worker draining coaching + quiz + video. A video job takes
 * 10-12 minutes, so it occupies a concurrency slot that coaching jobs queue
 * behind. The main bot solved this in bd-1372 by letting each worker service
 * poll a subset of queues (2 replicas main+quiz, 1 replica video); the fork
 * never got that code.
 *
 * The most important assertion here is the DEFAULT one: unset WORKER_QUEUES must
 * still mean "all queues". Deploying this code alone must change nothing — the
 * split only begins when the env var is set on a service.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
// The worker transitively requires the coaching orchestrator, which builds an
// OpenAI/OpenRouter client at module load. Factory-mock it so this test needs no
// credentials — it is asserting env parsing, nothing that talks to a model.
jest.mock('../../shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(), extractReflectiveCorpus: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(), generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));

// The worker's require-chain constructs an LLM client at module load. This test
// asserts env parsing only and never calls a model, so a dummy key is enough to
// let the module graph load. (Set BEFORE the require below — order matters.)
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

const { SQSCoachingWorker } = require('../../workers/sqs-worker');

const ORIGINAL = process.env.WORKER_QUEUES;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.WORKER_QUEUES;
  else process.env.WORKER_QUEUES = ORIGINAL;
});

const enabled = () => [...SQSCoachingWorker._enabledQueues()].sort();

describe('bd-2240 — WORKER_QUEUES resolution', () => {
  test('UNSET → all queues (deploying this change alone is a no-op)', () => {
    delete process.env.WORKER_QUEUES;
    expect(enabled()).toEqual(['main', 'quiz', 'video']);
  });

  test('empty / whitespace → all queues, never an empty set that polls nothing', () => {
    process.env.WORKER_QUEUES = '   ';
    expect(enabled()).toEqual(['main', 'quiz', 'video']);
    process.env.WORKER_QUEUES = ',,';
    expect(enabled()).toEqual(['main', 'quiz', 'video']);
  });

  test('the coaching split: main,quiz excludes video', () => {
    process.env.WORKER_QUEUES = 'main,quiz';
    const e = enabled();
    expect(e).toEqual(['main', 'quiz']);
    expect(e).not.toContain('video');
  });

  test('the video worker polls video only — this is what unblocks coaching', () => {
    process.env.WORKER_QUEUES = 'video';
    expect(enabled()).toEqual(['video']);
  });

  test('tolerates spacing and case from a hand-typed env var', () => {
    process.env.WORKER_QUEUES = ' Main , QUIZ ';
    expect(enabled()).toEqual(['main', 'quiz']);
  });

  test('read fresh every call — no caching, so a redeploy is not needed to observe a change', () => {
    process.env.WORKER_QUEUES = 'main';
    expect(enabled()).toEqual(['main']);
    process.env.WORKER_QUEUES = 'video';
    expect(enabled()).toEqual(['video']);
  });
});
