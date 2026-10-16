'use strict';
/**
 * A grounded request the stale recovery re-queues goes back to the GROUNDED render.
 *
 * A grounded render whose worker dies mid-job (a redeploy, a render past the stale window) is picked up
 * by the periodic recovery and re-queued. The re-queue rebuilt its SQS message from the request row and
 * left out sourceLpUuid, which is the one field the worker routes on: on the sandbox the job then landed
 * in the "stale freeform job, drop it" branch, and on staging and production — which still generate
 * freeform Gamma plans — she would have been sent a freeform plan she never asked for, recorded as the
 * grounded path's. A row the grounded path recorded names its curriculum row (artifact_ref); the
 * re-queue now carries it.
 *
 * Faked: the network (SQS — the message is captured, Gamma via the content service, WhatsApp, R2) and the
 * database (in memory). The queue service's re-queue and the worker are real.
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockEvent = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/queue', () => ({ queueCoachingJob: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => 'corr-requeue-1',
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

const Queue = require('../../bot/shared/services/queue');
const CurriculumLpAstService = require('../../bot/shared/services/curriculum-lp-ast.service');
const LessonPlanQueueService = require('../../bot/shared/services/lesson-plan-queue.service');
const Worker = require('../../bot/workers/lesson-plan-generation.worker');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const PHONE = '923001234567';
const AST = {
  source_lp_uuid: 'ast-uuid-7', publisher: 'Taleemabad', grade: 2, subject: 'maths',
  topic: 'Subtracting 2-digit numbers without regrouping (Concrete)', chapter_number: 3, chapter_title: 'Take-Away Jungle',
};
const longAgo = () => new Date(Date.now() - 30 * 60 * 1000).toISOString();
const stuck = (extra) => ({
  id: 'req-stuck', user_id: TEACHER, phone_number: PHONE, topic: AST.topic, full_message: AST.topic,
  language: 'en', content_type: 'lesson_plan', status: 'processing', retry_count: 1, processing_started_at: longAgo(),
  ...extra,
});
const requeued = () => Queue.queueCoachingJob.mock.calls
  .filter(([, type]) => type === 'lesson_plan_generation').map(([, , payload]) => payload);
const failedEvents = () => mockEvent.mock.calls
  .filter(([name]) => name === 'lesson_plan.generation.failed').map(([, fields]) => fields);

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.REGION = 'niete';
  process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
  jest.clearAllMocks();
  CurriculumLpAstService.findByUuid.mockResolvedValue(AST);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

test('a stuck grounded request is re-queued with its curriculum row, and the worker renders it grounded again', async () => {
  const row = stuck({ source: 'niete_grounded', artifact_ref: AST.source_lp_uuid });
  mockDb.reset({ lesson_plan_requests: [row], lesson_plans: [], users: [{ id: TEACHER, phone_number: PHONE }] });

  await LessonPlanQueueService.requeueRequest(row);
  const [payload] = requeued();
  expect(payload).toEqual(expect.objectContaining({ requestId: 'req-stuck', sourceLpUuid: AST.source_lp_uuid }));

  // SQS hands that message to the worker: the grounded render runs (and fails, Gamma being out of credits).
  await Worker.process(payload).catch(() => {});
  expect(CurriculumLpAstService.findByUuid).toHaveBeenCalledWith(AST.source_lp_uuid);
  expect(failedEvents()).toEqual([
    expect.objectContaining({ requestId: 'req-stuck', source: 'niete_grounded', errorCode: 'RENDER_FAILED' }),
  ]);
});

test('a stuck source-less request (freeform, or asked with the switch off) is re-queued exactly as before', async () => {
  const row = stuck({ content_type: 'presentation', topic: 'Photosynthesis', full_message: 'make a presentation about photosynthesis' });
  mockDb.reset({ lesson_plan_requests: [row], lesson_plans: [], users: [{ id: TEACHER, phone_number: PHONE }] });

  await LessonPlanQueueService.requeueRequest(row);
  expect(requeued()).toEqual([{
    requestId: 'req-stuck', userId: TEACHER, phoneNumber: PHONE, topic: 'Photosynthesis',
    fullMessage: 'make a presentation about photosynthesis', language: 'en', contentType: 'presentation',
  }]);
});

test('a row that names the grounded source but no curriculum row is re-queued as before (nothing to route on)', async () => {
  const row = stuck({ source: 'niete_grounded' });
  mockDb.reset({ lesson_plan_requests: [row], lesson_plans: [], users: [{ id: TEACHER, phone_number: PHONE }] });

  await LessonPlanQueueService.requeueRequest(row);
  expect(requeued()[0]).not.toHaveProperty('sourceLpUuid');
});
