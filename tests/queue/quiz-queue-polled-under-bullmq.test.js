'use strict';
/**
 * The worker polls the quiz queue whenever WORKER_QUEUES enables it and the queue
 * DRIVER has one — not only when an SQS queue URL is set.
 *
 * Under QUEUE_DRIVER=bullmq (the local mock lane, any deploy without AWS) the bot
 * enqueued quiz_generate onto the BullMQ quiz queue and the worker never took it:
 * both the own-loop decision and the combined poll gated the quiz queue on
 * SQS_QUIZ_QUEUE_URL, an SQS credential, so every generated quiz sat "generating"
 * for ever. Executed against the real worker class with env as the boundary.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null, runWithCorrelation: (id, fn) => fn() }));

function load(env) {
  jest.resetModules();
  for (const k of ['QUEUE_DRIVER', 'WORKER_QUEUES', 'SQS_QUEUE_URL', 'SQS_QUIZ_QUEUE_URL', 'SQS_VIDEO_QUEUE_URL', 'QUIZ_QUEUE_OWN_LOOP', 'REDIS_URL']) delete process.env[k];
  Object.assign(process.env, env);
  return require('../../bot/workers/sqs-worker').SQSCoachingWorker;
}

test('bullmq + WORKER_QUEUES=main,quiz → the quiz queue is polled (its own loop), with no SQS URL at all', () => {
  const W = load({ QUEUE_DRIVER: 'bullmq', REDIS_URL: 'redis://127.0.0.1:6390', WORKER_QUEUES: 'main,quiz' });
  expect(W._hasDedicatedQueue('quiz')).toBe(true);
  expect(W._quizOwnLoop()).toBe(true);
});

test('sqs without SQS_QUIZ_QUEUE_URL → no quiz queue to poll (unchanged)', () => {
  const W = load({ QUEUE_DRIVER: 'sqs', SQS_QUEUE_URL: 'https://sqs/main', WORKER_QUEUES: 'main,quiz' });
  expect(W._hasDedicatedQueue('quiz')).toBe(false);
  expect(W._quizOwnLoop()).toBe(false);
});

test('sqs with the URL → polled, as before', () => {
  const W = load({ QUEUE_DRIVER: 'sqs', SQS_QUEUE_URL: 'https://sqs/main', SQS_QUIZ_QUEUE_URL: 'https://sqs/quiz', WORKER_QUEUES: 'main,quiz' });
  expect(W._hasDedicatedQueue('quiz')).toBe(true);
  expect(W._quizOwnLoop()).toBe(true);
});
