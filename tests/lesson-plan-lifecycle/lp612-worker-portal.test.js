'use strict';
/**
 * A grade 6-12 lesson asked for in the PORTAL (or the teacher app) and written by the worker leaves
 * its lifecycle row when it becomes ready for her — and her portal claim names it.
 *
 * THE HOLE. A portal ask that has to be written joins the render's waiter list with no phone. When
 * the worker finishes, it skips the send for her (the portal shows the lesson on her next poll) and
 * writes only her claim row — so the ask left no lesson_plan_requests row, on the surface where most
 * NIETE teachers now ask for their plans.
 *
 * Driven through Worker.process — the function the queue actually calls. Faked: the LLM author, the
 * PDF renderer, R2, the file read, WhatsApp and the logs; Supabase is the stateful in-memory double,
 * with the waiter claim as its RPC. The serving module, the deliveries store and the lifecycle writer
 * are the real ones.
 */

const mockAuthorLessonPlan = jest.fn();
const mockRenderLessonPlan = jest.fn();
const mockReadFile = jest.fn();
const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();

jest.mock('../../bot/shared/services/lp612-author.service', () => ({ authorLessonPlan: (...a) => mockAuthorLessonPlan(...a) }));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({ renderLessonPlan: (...a) => mockRenderLessonPlan(...a) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('ok'),
  getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/x.pdf'),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn(), getDeliveryType: () => 'segment' }));
jest.mock('../../bot/shared/services/lp612-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: (...a) => mockReadFile(...a) },
}));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => mockDb.from(t),
  rpc: (...a) => mockDb.rpc(...a),
}));

const Worker = require('../../bot/workers/lp612-author.worker');

const RENDER = '22222222-2222-4222-8222-222222222222';
const PORTAL_TEACHER = '44444444-4444-4444-8444-444444444444';
const SEGMENT = {
  segment_id: 'grade_8_mathematics.c05.p071-073', book_stem: 'grade_8_mathematics', chapter_key: 'c05', grade: 8,
  subject: 'Mathematics', chapter_number: 5, chapter_title: 'Sets', subtopic_title: 'Set-builder notation',
  menu_title: 'Sets & notation', printed_page_start: 71, printed_page_end: 73, is_religious: false, language: 'en',
};
const WAITER = {
  user_id: PORTAL_TEACHER, phone: null, ui_lang: 'en', surface: 'portal',
  requested_at: '2026-10-13T05:00:00.000Z', correlation_id: 'portal-ask-1',
};
const JOB = { renderId: RENDER, segmentId: SEGMENT.segment_id, lang: 'en', templateVersion: 'v9.7', correlationId: 'job-1' };

const rows = (t) => mockDb.table(t);
const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  process.env.REGION = 'niete';
  jest.clearAllMocks();
  mockDb = createMemorySupabase({
    niete_lp612_renders: [{
      id: RENDER, segment_id: SEGMENT.segment_id, lang: 'en', template_version: 'v9.7', status: 'authoring', waiters: [WAITER],
    }],
    niete_lp612_segments: [SEGMENT],
    users: [{ id: PORTAL_TEACHER, phone_number: '923005550000', preferred_language: 'en' }],
    niete_lp612_deliveries: [],
    lesson_plan_requests: [],
  }, {
    rpc: { lp612_claim_waiters: () => ({ data: [WAITER], error: null }) },
  });
  require('../../bot/shared/services/lp612-deliveries.store').__resetForTests();
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockSendMessage.mockResolvedValue(true);
  mockSendDocumentByLink.mockResolvedValue(true);
  mockAuthorLessonPlan.mockResolvedValue({
    lpDoc: { lesson_id: 'x', one_screen: 'a summary' }, lintClean: true, fails: [], rounds: 2,
    model: 'anthropic/claude-sonnet-5', family: 'maths', tier: 'standard',
  });
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [], overlayApplied: [],
  });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('the worker finishes a lesson a PORTAL teacher is waiting for', () => {
  test('switched ON: ONE completed row (channel portal) — asked when she asked, ready when it was ready — and her claim names it', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    await Worker.process(JOB);
    expect(rows('niete_lp612_renders')[0].status).toBe('ready');
    const asks = rows('lesson_plan_requests');
    expect(asks).toHaveLength(1);
    expect(asks[0]).toEqual(expect.objectContaining({
      user_id: PORTAL_TEACHER, phone_number: '923005550000', channel: 'portal', status: 'completed',
      source: 'niete_lp612', artifact_ref: SEGMENT.segment_id, grade: 8, subject: 'Mathematics',
      created_at: '2026-10-13T05:00:00.000Z', correlation_id: 'portal-ask-1', error_code: null,
    }));
    expect(asks[0].generated_at).toBeTruthy();
    expect(asks[0].delivered_at).toBe(asks[0].generated_at);
    const [claim] = rows('niete_lp612_deliveries');
    expect(claim).toEqual(expect.objectContaining({ user_id: PORTAL_TEACHER, surface: 'portal', request_id: asks[0].id }));
    // Nothing is SENT to a portal teacher — the lesson waits in her portal, as before.
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
  });

  test('switched OFF: her claim is exactly the old row and no lifecycle row is written', async () => {
    await Worker.process(JOB);
    expect(rows('niete_lp612_renders')[0].status).toBe('ready');
    expect(rows('lesson_plan_requests')).toHaveLength(0);
    const [claim] = rows('niete_lp612_deliveries');
    expect(claim).toEqual(expect.objectContaining({ user_id: PORTAL_TEACHER, surface: 'portal' }));
    expect(claim).not.toHaveProperty('request_id');
  });
});

describe('the worker gives up on a render — driven through Worker.process, fail() and its waiters', () => {
  const WA_TEACHER = '55555555-5555-4555-8555-555555555555';
  const WA_WAITER = {
    user_id: WA_TEACHER, phone: '923001234567', ui_lang: 'en', surface: 'whatsapp',
    requested_at: '2026-10-13T05:00:30.000Z', correlation_id: 'wa-ask-1',
  };
  const seed = (segments) => {
    mockDb = createMemorySupabase({
      niete_lp612_renders: [{
        id: RENDER, segment_id: SEGMENT.segment_id, lang: 'en', template_version: 'v9.7', status: 'authoring', waiters: [WAITER, WA_WAITER],
      }],
      niete_lp612_segments: segments,
      users: [{ id: PORTAL_TEACHER, phone_number: '923005550000', preferred_language: 'en' }],
      niete_lp612_deliveries: [],
      lesson_plan_requests: [],
    }, {
      rpc: { lp612_claim_waiters: () => ({ data: [WAITER, WA_WAITER], error: null }) },
    });
  };

  test('switched ON: the WhatsApp waiter is TOLD FIRST, then one failed row per waiter (RENDER_FAILED, both channels)', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    seed([SEGMENT]);
    mockRenderLessonPlan.mockRejectedValue(Object.assign(new Error('chromium died'), { code: 'RENDER_FAILED' }));
    let rowsWhenTold = null;
    mockSendMessage.mockImplementation(async () => { rowsWhenTold = rows('lesson_plan_requests').length; return true; });
    await Worker.process(JOB);
    expect(mockSendMessage).toHaveBeenCalledWith('923001234567', expect.any(String));
    expect(rowsWhenTold).toBe(0); // nobody waits on the record before she hears
    const asks = rows('lesson_plan_requests');
    expect(asks).toHaveLength(2);
    expect(asks.map((r) => r.channel).sort()).toEqual(['portal', 'whatsapp']);
    asks.forEach((r) => expect(r).toEqual(expect.objectContaining({ status: 'failed', error_code: 'RENDER_FAILED', source: 'niete_lp612' })));
  });

  test('switched ON: a segment that vanished before the render is a content answer — NO_ASSET, not a generation failure', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_lp612';
    seed([]);
    await Worker.process(JOB);
    const asks = rows('lesson_plan_requests');
    expect(asks).toHaveLength(2);
    asks.forEach((r) => expect(r).toEqual(expect.objectContaining({ status: 'failed', error_code: 'NO_ASSET' })));
  });
});
