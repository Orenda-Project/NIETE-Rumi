'use strict';
/**
 * The curriculum ("grounded") lesson-plan family leaves its lifecycle trail — and nothing the teacher
 * sees, and nothing the queue does, changes.
 *
 * THREE SHAPES, one family:
 *   · a QUEUED render keeps its own lesson_plan_requests row (pending → processing → completed |
 *     failed). Its insert gains the path, grade, subject and catalogue id; its existing stage
 *     updates gain generated_at / delivered_at / error_code. Its STATUS is left exactly as today —
 *     the worker's retry and idempotency read it — so a send WhatsApp refused shows as
 *     error_code DELIVERY_FAILED with no delivered_at, on a row the pipeline calls completed.
 *   · a CACHE HIT (the AST PDF already in R2) and a PRE-GENERATED chapter are served there and then:
 *     one finished lifecycle row each, written before the plan row the survey hangs off, which
 *     names it.
 *   · the two sends that used to throw their result away now return it — observation only; no
 *     caller changes what it does with it.
 *
 * Network faked only: Supabase (stateful, in memory), WhatsApp, R2, Gamma, the survey timer,
 * the feature linker; the curriculum lookups for the handler cases.
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockEvent = jest.fn();
let mockCorrelationId = 'corr-webhook-1';
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/queue', () => ({ queueCoachingJob: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => mockCorrelationId,
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendDocument: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 cached')),
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/services/oxbridge-lp.service', () => ({ isEligibleGrade: () => false }));
const mockFindByTopic = jest.fn();
const mockFindChapter = jest.fn();
const mockFindPreGen = jest.fn();
jest.mock('../../bot/shared/services/topic-matching.service', () => ({ findChapterByTopic: (...a) => mockFindChapter(...a) }));
jest.mock('../../bot/shared/services/pregen-lookup.service', () => ({ findPreGenLP: (...a) => mockFindPreGen(...a) }));
jest.mock('../../bot/shared/services/curriculum-lp-ast.service', () => ({
  findByTopic: (...a) => mockFindByTopic(...a),
  findByUuid: jest.fn(),
  setRenderedPdfKey: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/services/content.service', () => ({
  generateLessonPlan: jest.fn().mockResolvedValue({ pdfUrl: 'https://gamma.example/x.pdf' }),
}));
jest.mock('axios', () => ({ get: jest.fn().mockResolvedValue({ data: Buffer.from('%PDF-1.4 fresh') }) }));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({ checkAndSuggest: jest.fn(), suggestNext: jest.fn() }));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({ checkAndTriggerRegistration: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const LessonPlanQueueService = require('../../bot/shared/services/lesson-plan-queue.service');
const handleCurriculumLessonPlan = require('../../bot/shared/handlers/lesson-plan-v2.handler');
const Worker = require('../../bot/workers/lesson-plan-generation.worker');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const PHONE = '923001234567';
const AST = {
  source_lp_uuid: 'ast-uuid-1', publisher: 'NBF', grade: 3, subject: 'Science', topic: 'Plants',
  chapter_number: 2, chapter_title: 'Living things', pdf_r2_key_en: 'lps/curriculum-ast/ast-uuid-1.en.pdf',
};
const rows = (t) => mockDb.rows(t);

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  process.env.REGION = 'niete';
  jest.clearAllMocks();
  WhatsAppService.sendDocument.mockResolvedValue(true);
  mockCorrelationId = 'corr-webhook-1';
  mockDb.reset({ lesson_plan_requests: [], lesson_plans: [], users: [{ id: TEACHER, phone_number: PHONE }] });
  mockFindByTopic.mockResolvedValue(null);
  mockFindChapter.mockResolvedValue(null);
  mockFindPreGen.mockResolvedValue(null);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('the queued render — its own request row gains the lifecycle columns', () => {
  const enqueue = () => LessonPlanQueueService.createAndQueueGrounded({
    userId: TEACHER, phoneNumber: PHONE, sourceLpUuid: AST.source_lp_uuid, topic: AST.topic,
    chapterTitle: AST.chapter_title, language: 'en', grade: AST.grade, subject: AST.subject,
  });

  test('switched OFF: the insert is exactly the old row', async () => {
    await enqueue();
    expect(Object.keys(rows('lesson_plan_requests')[0]).sort()).toEqual(
      ['content_type', 'full_message', 'id', 'language', 'phone_number', 'status', 'topic', 'user_id'],
    );
  });

  test('switched ON: the insert carries path, channel, region, grade, subject, catalogue id and log id', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
    const id = await enqueue();
    expect(rows('lesson_plan_requests')[0]).toEqual(expect.objectContaining({
      id, status: 'pending', source: 'niete_grounded', channel: 'whatsapp', region: 'niete', grade: 3,
      subject: 'Science', artifact_ref: 'ast-uuid-1', correlation_id: 'corr-webhook-1',
    }));
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.request.created', expect.objectContaining({ requestId: id, source: 'niete_grounded' }));
  });

  test('markCompleted, switched OFF: the update is exactly the old one', async () => {
    const id = await enqueue();
    await LessonPlanQueueService.markCompleted(id, { gammaUrl: null, pdfUrl: 'k.pdf', generatedAt: '2026-10-13T05:01:00.000Z', sent: true });
    const row = rows('lesson_plan_requests')[0];
    expect(row).not.toHaveProperty('generated_at');
    expect(row).not.toHaveProperty('delivered_at');
    expect(row.status).toBe('completed');
  });

  test('markCompleted, switched ON: generated_at + delivered_at when the send was accepted', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
    const id = await enqueue();
    await LessonPlanQueueService.markCompleted(id, { gammaUrl: null, pdfUrl: 'k.pdf', generatedAt: '2026-10-13T05:01:00.000Z', sent: true });
    expect(rows('lesson_plan_requests')[0]).toEqual(expect.objectContaining({
      status: 'completed', generated_at: '2026-10-13T05:01:00.000Z', error_code: null,
    }));
    expect(rows('lesson_plan_requests')[0].delivered_at).toBeTruthy();
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.delivery.sent', expect.objectContaining({ requestId: id }));
  });

  test('markCompleted, switched ON: a refused send keeps status completed (the queue reads it) but says DELIVERY_FAILED, no delivered_at', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
    const id = await enqueue();
    await LessonPlanQueueService.markCompleted(id, { gammaUrl: null, pdfUrl: 'k.pdf', generatedAt: '2026-10-13T05:01:00.000Z', sent: false });
    const row = rows('lesson_plan_requests')[0];
    expect(row).toEqual(expect.objectContaining({ status: 'completed', error_code: 'DELIVERY_FAILED' }));
    expect(row).not.toHaveProperty('delivered_at');
  });

  test('markFailed: OFF the old update; ON it adds GENERATION_FAILED', async () => {
    const id = await enqueue();
    await LessonPlanQueueService.markFailed(id, 'gamma 403');
    expect(rows('lesson_plan_requests')[0]).not.toHaveProperty('error_code');
    process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
    await LessonPlanQueueService.markFailed(id, 'gamma 403');
    expect(rows('lesson_plan_requests')[0]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'GENERATION_FAILED' }));
  });
});

describe('the worker — stage times reach the row, and the plan row names its request', () => {
  const job = (id) => ({
    requestId: id, userId: TEACHER, phoneNumber: PHONE, sourceLpUuid: AST.source_lp_uuid,
    topic: AST.topic, chapterTitle: AST.chapter_title, language: 'en', lp: AST,
  });

  test('switched ON: generated_at, delivered_at, and lesson_plans.request_id', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
    const id = await LessonPlanQueueService.createAndQueueGrounded({
      userId: TEACHER, phoneNumber: PHONE, sourceLpUuid: AST.source_lp_uuid, topic: AST.topic, language: 'en',
    });
    await Worker.processGrounded(job(id));
    const req = rows('lesson_plan_requests')[0];
    expect(req).toEqual(expect.objectContaining({ status: 'completed', error_code: null }));
    expect(req.generated_at).toBeTruthy();
    expect(req.delivered_at).toBeTruthy();
    expect(rows('lesson_plans')[0].request_id).toBe(id);
  });

  test('switched OFF: the plan row carries no request_id key', async () => {
    const id = await LessonPlanQueueService.createAndQueueGrounded({
      userId: TEACHER, phoneNumber: PHONE, sourceLpUuid: AST.source_lp_uuid, topic: AST.topic, language: 'en',
    });
    await Worker.processGrounded(job(id));
    expect(rows('lesson_plans')[0]).not.toHaveProperty('request_id');
    expect(rows('lesson_plan_requests')[0]).not.toHaveProperty('generated_at');
  });
});

describe('cache hit and pre-generated — served there and then, one finished row each', () => {
  const ask = () => handleCurriculumLessonPlan({
    userId: PHONE, userDbId: TEACHER, topic: 'Plants', grade: 3, subject: 'Science', curriculum: 'nbf', language: 'en',
  });

  test('switched OFF: no lifecycle row; the plan row is the old one', async () => {
    mockFindByTopic.mockResolvedValue(AST);
    const res = await ask();
    expect(res.source).toBe('ast_cached');
    expect(rows('lesson_plan_requests')).toHaveLength(0);
    expect(rows('lesson_plans')[0]).not.toHaveProperty('request_id');
  });

  test('switched ON: a cache hit writes ONE completed niete_grounded row, and the plan row names it', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
    mockFindByTopic.mockResolvedValue(AST);
    await ask();
    const [row] = rows('lesson_plan_requests');
    expect(row).toEqual(expect.objectContaining({
      user_id: TEACHER, status: 'completed', source: 'niete_grounded', artifact_ref: 'ast-uuid-1', grade: 3,
      subject: 'Science', topic: 'Plants', correlation_id: 'corr-webhook-1',
    }));
    expect(rows('lesson_plans')[0].request_id).toBe(row.id);
  });

  test('switched ON: a cache-hit send WhatsApp refused → FAILED (DELIVERY_FAILED); the plan row and survey are as before', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_grounded';
    mockFindByTopic.mockResolvedValue(AST);
    WhatsAppService.sendDocument.mockResolvedValue(false);
    await ask();
    const [row] = rows('lesson_plan_requests');
    expect(row).toEqual(expect.objectContaining({ status: 'failed', error_code: 'DELIVERY_FAILED' }));
    expect(rows('lesson_plans')).toHaveLength(1);
  });

  test('switched ON: a pre-generated chapter writes ONE completed pre_gen_chapter row naming the pre-gen id', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'all';
    mockFindChapter.mockResolvedValue({ chapter_number: 4, chapter_title: 'Water' });
    mockFindPreGen.mockResolvedValue({ id: 'pregen-9', pdf_r2_key_en: 'lps/pregen/9.en.pdf' });
    const res = await ask();
    expect(res.source).toBe('pre_generated');
    expect(rows('lesson_plan_requests')[0]).toEqual(expect.objectContaining({
      status: 'completed', source: 'pre_gen_chapter', artifact_ref: 'pregen-9', grade: 3,
    }));
  });

  test('the WhatsApp sends are identical with the switch off and on', async () => {
    mockFindByTopic.mockResolvedValue(AST);
    await ask();
    const off = WhatsAppService.sendDocument.mock.calls.map((c) => [c[0], c[2]]);
    jest.clearAllMocks();
    WhatsAppService.sendDocument.mockResolvedValue(true);
    mockDb.reset({ lesson_plan_requests: [], lesson_plans: [], users: [{ id: TEACHER, phone_number: PHONE }] });
    process.env.LP_LIFECYCLE_PATHS = 'all';
    await ask();
    const on = WhatsAppService.sendDocument.mock.calls.map((c) => [c[0], c[2]]);
    expect(on).toEqual(off);
  });
});
