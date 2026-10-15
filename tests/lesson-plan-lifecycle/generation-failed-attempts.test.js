'use strict';
/**
 * `lesson_plan.generation.failed` says which attempt failed and whether it was the last one.
 *
 * A grounded render that fails is retried by SQS (the message comes back after its visibility
 * timeout) until the worker's attempt limit — three. Each attempt marks the request failed, and each
 * used to emit an identical event: on the sandbox (2026-10-14) Gamma ran out of credits and one ask
 * produced one event per attempt, indistinguishable. Counting events then counts one failed ask up to
 * three times. The row was always right; the event now carries `attempt` and `final`, so a count can
 * take `final` and get one per ask. A job the worker DROPS (a stale freeform message) is final on its
 * first attempt.
 *
 * Faked: the network (Gamma via the content service, WhatsApp, R2, the survey timer) and the database
 * (in memory). The queue service, the worker and the render service are real.
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockEvent = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/queue', () => ({ queueCoachingJob: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => 'corr-typed-2',
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendDocument: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn().mockResolvedValue(null),
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/services/curriculum-lp-ast.service', () => ({
  findByTopic: jest.fn(), findByUuid: jest.fn(), setRenderedPdfKey: jest.fn(),
}));
// Gamma answering 403 "Insufficient credits": the render gets no PDF back.
jest.mock('../../bot/shared/services/content.service', () => ({
  generateLessonPlan: jest.fn().mockResolvedValue({ pdfUrl: null }),
}));
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({ checkAndSuggest: jest.fn(), suggestNext: jest.fn() }));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({ checkAndTriggerRegistration: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const LessonPlanQueueService = require('../../bot/shared/services/lesson-plan-queue.service');
const Worker = require('../../bot/workers/lesson-plan-generation.worker');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const PHONE = '923001234567';
const AST = {
  source_lp_uuid: 'ast-uuid-7', publisher: 'Taleemabad', grade: 2, subject: 'maths',
  topic: 'Subtracting 2-digit numbers without regrouping (Concrete)', chapter_number: 3, chapter_title: 'Take-Away Jungle',
};
const failedEvents = () => mockEvent.mock.calls
  .filter(([name]) => name === 'lesson_plan.generation.failed').map(([, fields]) => fields);

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.REGION = 'niete';
  process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
  jest.clearAllMocks();
  mockDb.reset({ lesson_plan_requests: [], lesson_plans: [], users: [{ id: TEACHER, phone_number: PHONE }] });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

test('a render that keeps failing: attempts 1, 2, 3 — only the third is final, and only then is she told', async () => {
  const id = await LessonPlanQueueService.createAndQueueGrounded({
    userId: TEACHER, phoneNumber: PHONE, sourceLpUuid: AST.source_lp_uuid, topic: AST.topic, language: 'en',
  });
  const job = { requestId: id, userId: TEACHER, phoneNumber: PHONE, sourceLpUuid: AST.source_lp_uuid, topic: AST.topic, language: 'en', lp: AST };

  // SQS hands the same message back after each failure; the third attempt is the worker's last.
  await expect(Worker.processGrounded(job)).rejects.toThrow(/Grounded render failed/);
  await expect(Worker.processGrounded(job)).rejects.toThrow(/Grounded render failed/);
  expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  await Worker.processGrounded(job);   // the last attempt does not re-throw: the job is done
  expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);

  expect(failedEvents()).toEqual([
    expect.objectContaining({ requestId: id, errorCode: 'RENDER_FAILED', attempt: 1, final: false }),
    expect.objectContaining({ requestId: id, errorCode: 'RENDER_FAILED', attempt: 2, final: false }),
    expect.objectContaining({ requestId: id, errorCode: 'RENDER_FAILED', attempt: 3, final: true }),
  ]);
  expect(mockDb.rows('lesson_plan_requests')).toEqual([
    expect.objectContaining({ id, status: 'failed', retry_count: 3, error_code: 'RENDER_FAILED' }),
  ]);
});

test('a job the worker drops (a stale freeform message) is final on its first attempt', async () => {
  mockDb.reset({
    // a grounded row (the path recorded it) whose job arrives without its sourceLpUuid lands in the drop branch
    lesson_plan_requests: [{ id: 'req-stale', user_id: TEACHER, phone_number: PHONE, status: 'pending', retry_count: 0, source: 'niete_grounded' }],
    lesson_plans: [], users: [{ id: TEACHER, phone_number: PHONE }],
  });
  await Worker.process({ requestId: 'req-stale', userId: TEACHER, phoneNumber: PHONE, topic: 'fractions', contentType: 'lesson_plan' });
  expect(failedEvents()).toEqual([expect.objectContaining({ requestId: 'req-stale', attempt: 1, final: true })]);
});
