'use strict';
/**
 * Free-form lesson plans — the queue and the worker (NIETE).
 *
 * On this deployment the free-form path was stripped: the queue only had createAndQueueGrounded,
 * and the worker DROPS any job without a sourceLpUuid ("Non-grounded LP job received after Gamma
 * strip"). The free-form engine therefore needs:
 *   1. LessonPlanQueueService.createAndQueueFreeform — a lesson_plan_requests row with
 *      source='freeform_v1', and a lesson_plan_generation job whose payload carries track='freeform_v1';
 *   2. a `track === 'freeform_v1'` branch in the worker BEFORE the drop, handing the job to the
 *      engine (fflp.engine.generateAndDeliver). The engine is ported by a later change; until then
 *      the lazy index throws FflpModuleMissing and the job is failed, once, with the existing apology.
 * The grounded path and the drop are unchanged (asserted below).
 *
 * Real: the queue service, the lifecycle writer, the worker, the fflp index. Faked: the database
 * (memory), the SQS driver, WhatsApp, and the generation services the free-form job never reaches.
 */
const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
const mockSqs = [];
jest.mock('../../bot/shared/services/queue', () => ({
  queueCoachingJob: jest.fn(async (id, type, payload) => { mockSqs.push({ id, type, payload }); return { MessageId: 'm-1' }; }),
}));
const mockWa = { sendMessage: jest.fn(async () => true), sendFlow: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true) };
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockWa.sendMessage(...a),
  sendFlow: (...a) => mockWa.sendFlow(...a),
  sendCtaUrl: (...a) => mockWa.sendCtaUrl(...a),
}));
jest.mock('../../bot/shared/services/content.service', () => ({}));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({}));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({}));
jest.mock('../../bot/shared/services/curriculum-lp-ast.service', () => ({}));
const mockGrounded = jest.fn();
jest.mock('../../bot/shared/services/grounded-lp-render.service', () => ({ renderAndServeGrounded: (...a) => mockGrounded(...a) }));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({ storeLessonPlan: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const LessonPlanQueueService = require('../../bot/shared/services/lesson-plan-queue.service');
const Worker = require('../../bot/workers/lesson-plan-generation.worker');
const fflp = require('../../bot/shared/services/fflp');

const PHONE = '923000000002';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const APOLOGY_UR = 'معذرت، آپ کا لیسن پلان بنانے میں مسئلہ ہوا۔ براہ کرم اپنی درخواست دوبارہ بھیج کر کوشش کریں۔';

beforeEach(() => {
  mockDb.reset({});
  mockSqs.length = 0;
  jest.clearAllMocks();
  delete process.env.LP_LIFECYCLE_PATHS;
});

describe('createAndQueueFreeform', () => {
  test('inserts a freeform_v1 request row and queues lesson_plan_generation with track=freeform_v1', async () => {
    const id = await LessonPlanQueueService.createAndQueueFreeform({
      userId: USER_ID, phoneNumber: PHONE, topic: 'volcanoes', fullMessage: 'lesson plan on volcanoes', language: 'ur', entry: 'niete_catalogue_miss',
    });
    const rows = mockDb.rows('lesson_plan_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id, user_id: USER_ID, phone_number: PHONE, topic: 'volcanoes', full_message: 'lesson plan on volcanoes',
      language: 'ur', content_type: 'lesson_plan', status: 'pending', source: 'freeform_v1',
    });
    expect(mockSqs).toEqual([{ id, type: 'lesson_plan_generation', payload: expect.objectContaining({
      requestId: id, userId: USER_ID, phoneNumber: PHONE, topic: 'volcanoes', fullMessage: 'lesson plan on volcanoes',
      language: 'ur', contentType: 'lesson_plan', track: 'freeform_v1', entry: 'niete_catalogue_miss',
    }) }]);
    expect(mockSqs[0].payload.sourceLpUuid).toBeUndefined();
  });
  test('an SQS failure leaves the row pending for the recovery sweep and still returns the id', async () => {
    const SQS = require('../../bot/shared/services/queue');
    SQS.queueCoachingJob.mockRejectedValueOnce(new Error('sqs down'));
    const id = await LessonPlanQueueService.createAndQueueFreeform({ userId: USER_ID, phoneNumber: PHONE, topic: 't', language: 'en' });
    expect(mockDb.rows('lesson_plan_requests')[0]).toMatchObject({ id, status: 'pending', error_message: 'SQS queue failed: sqs down' });
  });
  test('an insert the database refuses throws (the caller falls back to today\'s reply)', async () => {
    const real = mockDb.from;
    mockDb.from = (t) => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'violates check constraint' } }) }) }) });
    try {
      await expect(LessonPlanQueueService.createAndQueueFreeform({ userId: USER_ID, phoneNumber: PHONE, topic: 't' }))
        .rejects.toThrow(/violates check constraint/);
    } finally { mockDb.from = real; }
    expect(mockSqs).toHaveLength(0);
  });
  test('requeueRequest keeps the track of a freeform_v1 row (else the worker would drop it)', async () => {
    await LessonPlanQueueService.requeueRequest({ id: 'r-9', user_id: USER_ID, phone_number: PHONE, topic: 't', full_message: 't', language: 'en', content_type: 'lesson_plan', source: 'freeform_v1' });
    expect(mockSqs[0].payload.track).toBe('freeform_v1');
    mockSqs.length = 0;
    await LessonPlanQueueService.requeueRequest({ id: 'r-8', user_id: USER_ID, phone_number: PHONE, topic: 't', content_type: 'lesson_plan', source: null });
    expect(mockSqs[0].payload).not.toHaveProperty('track');
  });
});

describe('the worker branch', () => {
  const job = (extra = {}) => ({ requestId: 'req-ff', userId: USER_ID, phoneNumber: PHONE, topic: 'volcanoes', contentType: 'lesson_plan', language: 'ur', track: 'freeform_v1', ...extra });

  test('WRK-FF: engine not ported yet ⇒ FflpModuleMissing ⇒ one final markFailed + the existing apology; nothing else sent', async () => {
    mockDb.reset({ lesson_plan_requests: [{ id: 'req-ff', status: 'pending', retry_count: 0, source: 'freeform_v1' }] });
    expect(() => fflp.engine).toThrow(fflp.FflpModuleMissing);
    await Worker.process(job());
    expect(mockDb.rows('lesson_plan_requests')[0]).toMatchObject({ status: 'failed', retry_count: 1 });
    expect(mockDb.rows('lesson_plan_requests')[0].error_message).toMatch(/FflpModuleMissing|not available/);
    expect(mockWa.sendMessage.mock.calls).toEqual([[PHONE, APOLOGY_UR]]);
    expect(mockWa.sendFlow).not.toHaveBeenCalled();
  });

  test('WRK-FF: with the engine present, the job goes to engine.generateAndDeliver and the drop never runs', async () => {
    const gen = jest.fn(async () => ({ ok: true }));
    const spy = jest.spyOn(fflp._internals, 'resolveEngine').mockImplementation(() => ({ generateAndDeliver: gen }));
    mockDb.reset({ lesson_plan_requests: [{ id: 'req-ff', status: 'pending', retry_count: 0, source: 'freeform_v1' }] });
    try {
      await Worker.process(job());
      expect(gen).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-ff', track: 'freeform_v1', topic: 'volcanoes' }));
      expect(mockDb.rows('lesson_plan_requests')[0].status).not.toBe('failed');
      expect(mockWa.sendMessage).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  test('WRK-FF: an engine error before the last attempt is re-thrown for the queue to retry, without an apology', async () => {
    const spy = jest.spyOn(fflp._internals, 'resolveEngine').mockImplementation(() => ({ generateAndDeliver: async () => { throw new Error('author timeout'); } }));
    mockDb.reset({ lesson_plan_requests: [{ id: 'req-ff', status: 'pending', retry_count: 0, source: 'freeform_v1' }] });
    try {
      await expect(Worker.process(job())).rejects.toThrow('author timeout');
      expect(mockDb.rows('lesson_plan_requests')[0]).toMatchObject({ status: 'failed', retry_count: 1 });
      expect(mockWa.sendMessage).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  test('WRK-FF: a request already completed is skipped (SQS redelivery is safe)', async () => {
    const gen = jest.fn();
    const spy = jest.spyOn(fflp._internals, 'resolveEngine').mockImplementation(() => ({ generateAndDeliver: gen }));
    mockDb.reset({ lesson_plan_requests: [{ id: 'req-ff', status: 'completed', retry_count: 0, source: 'freeform_v1' }] });
    try {
      await Worker.process(job());
      expect(gen).not.toHaveBeenCalled();
      expect(mockWa.sendMessage).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  test('unchanged: a job with no track and no sourceLpUuid is still dropped exactly as before', async () => {
    mockDb.reset({ lesson_plan_requests: [{ id: 'req-old', status: 'pending', retry_count: 0 }] });
    delete process.env.PAKISTAN_LP_FLOW_ID;
    await Worker.process({ requestId: 'req-old', userId: USER_ID, phoneNumber: PHONE, topic: 'x', contentType: 'lesson_plan', language: 'en' });
    expect(mockDb.rows('lesson_plan_requests')[0]).toMatchObject({ status: 'failed', error_message: 'freeform LP generation is retired; only grounded AST jobs are processed' });
    expect(mockWa.sendMessage.mock.calls).toEqual([[PHONE, "We don't have that lesson plan in the catalog yet. Send \"menu\" to see what's available."]]);
  });

  test('unchanged: a grounded job (sourceLpUuid) still goes to the grounded path, even if a track rode along', async () => {
    mockDb.reset({ lesson_plan_requests: [{ id: 'req-g', status: 'pending', retry_count: 0 }] });
    const spy = jest.spyOn(Worker, 'processGrounded').mockResolvedValue(undefined);
    try {
      await Worker.process({ requestId: 'req-g', userId: USER_ID, phoneNumber: PHONE, sourceLpUuid: 'lp-1', topic: 't', track: 'freeform_v1' });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
});
