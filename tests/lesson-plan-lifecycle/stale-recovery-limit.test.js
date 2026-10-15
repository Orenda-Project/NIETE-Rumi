'use strict';
/**
 * The worker's stale-request recovery gives up at the SAME attempt limit as everything else.
 *
 * A grounded request stuck in `processing` (its worker died mid-render) is picked up by the periodic
 * recovery: under the limit it is re-queued; at the limit the teacher is told, and the request is
 * marked failed — finally. The limit is one constant, config/lesson-plan-generation.js, which the
 * generation worker, the queue service and the health check read. The recovery hand-copied its own
 * `3`, so the day the limit changes, recovery would re-queue a request the worker has already given
 * up on (or give up before the worker would). Here the shared limit is set to 2: a request at 2
 * attempts must be finished, not re-queued.
 *
 * Faked: the network (WhatsApp, SQS), the database (in memory), and the modules the worker file
 * loads that recovery never touches. The recovery and the queue service are real.
 */
jest.mock('../../bot/shared/config/lesson-plan-generation', () => ({ MAX_ATTEMPTS: 2 }));

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockEvent = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('express', () => {
  const app = { get: jest.fn(), listen: jest.fn(() => ({})) };
  return jest.fn(() => app);
}, { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true), sendDocumentByLink: jest.fn() }));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({}));
jest.mock('../../bot/workers/lesson-plan-extraction.worker', () => ({}));
jest.mock('../../bot/workers/lesson-plan-generation.worker', () => ({}));
jest.mock('../../bot/workers/video-generation.worker', () => ({}));
jest.mock('../../bot/workers/exam-grading.worker', () => ({}));
jest.mock('../../bot/shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({
  __isQueueSingleton: true, extendJobTimeout: jest.fn(() => Promise.resolve()), queueCoachingJob: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => 'corr-recovery-1',
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { recoverStaleLessonPlanRequests } = require('../../bot/workers/sqs-worker');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const PHONE = '923001234567';
const longAgo = () => new Date(Date.now() - 30 * 60 * 1000).toISOString();

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.REGION = 'niete';
  process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
  jest.clearAllMocks();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

test('a stuck request AT the shared limit is finished — told, marked failed, its failure final — not re-queued', async () => {
  mockDb.reset({
    lesson_plan_requests: [{
      id: 'req-stuck', user_id: TEACHER, phone_number: PHONE, language: 'en', status: 'processing',
      retry_count: 2, processing_started_at: longAgo(), source: 'niete_grounded',
    }],
    users: [{ id: TEACHER, phone_number: PHONE }],
  });
  await recoverStaleLessonPlanRequests();
  expect(mockDb.rows('lesson_plan_requests')[0]).toEqual(expect.objectContaining({ status: 'failed', retry_count: 3 }));
  expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
  const failed = mockEvent.mock.calls.filter(([n]) => n === 'lesson_plan.generation.failed').map(([, f]) => f);
  expect(failed).toEqual([expect.objectContaining({ requestId: 'req-stuck', final: true })]);
});

test('a stuck request UNDER the shared limit is re-queued, and nobody is told', async () => {
  mockDb.reset({
    lesson_plan_requests: [{
      id: 'req-young', user_id: TEACHER, phone_number: PHONE, language: 'en', status: 'processing',
      retry_count: 1, processing_started_at: longAgo(), source: 'niete_grounded',
    }],
    users: [{ id: TEACHER, phone_number: PHONE }],
  });
  await recoverStaleLessonPlanRequests();
  expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  expect(mockEvent.mock.calls.filter(([n]) => n === 'lesson_plan.generation.failed')).toHaveLength(0);
});
