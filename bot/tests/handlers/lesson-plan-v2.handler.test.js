/**
 * Integration tests for `handleCurriculumLessonPlan` (bot/shared/handlers/lesson-plan-v2.handler.js)
 *
 * Mocks the LP AST service, queue service, R2 storage, WhatsApp service, and
 * legacy pre-gen path so the whole handler can be driven through all four
 * outcomes without touching Supabase, Gamma, or Meta:
 *
 *   1. ast_cached    — AST row has pdf_r2_key_{lang} set → serve from R2
 *   2. ast_queued    — AST row exists but no cache → send ack, queue job
 *   3. ast_queued (Urdu) — Urdu-branch ack is Urdu; language routed to _ur cache
 *   4. Fallback      — no AST match + no pre-gen → page_prompt
 *   5. Fallback (no userDbId) — AST hit + cache-miss but caller has no user UUID
 *                    → we skip the queue (can't insert lesson_plan_requests) and
 *                    fall through to page_prompt so freeform can salvage
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
jest.mock('../../shared/services/curriculum-lp-ast.service', () => ({
  findByTopic: jest.fn(),
  findByUuid: jest.fn(),
  setRenderedPdfKey: jest.fn(),
}));

jest.mock('../../shared/services/topic-matching.service', () => ({
  findChapterByTopic: jest.fn(),
}));

jest.mock('../../shared/services/pregen-lookup.service', () => ({
  findPreGenLP: jest.fn(),
}));

const mockCreateAndQueueGrounded = jest.fn();
jest.mock('../../shared/services/lesson-plan-queue.service', () => ({
  createAndQueueGrounded: mockCreateAndQueueGrounded,
}));

// LP Feedback service — the handler transitively requires it (for cache-hit
// scheduling). We mock it out here so the test doesn't need Redis/Supabase.
const mockScheduleFeedbackPrompt = jest.fn();
jest.mock('../../shared/services/lp-feedback.service', () => ({
  scheduleFeedbackPrompt: mockScheduleFeedbackPrompt,
}));

// storeLessonPlan is called from the cache-hit path to create an FK target
// for the feedback row. Mock it out.
const mockStoreLessonPlan = jest.fn(() => Promise.resolve({ id: 'stub-lp-id' }));
jest.mock('../../shared/database/bot-helpers', () => ({
  storeLessonPlan: mockStoreLessonPlan,
}));

jest.mock('../../shared/storage/r2', () => ({
  downloadFromR2: jest.fn(() => Promise.resolve(Buffer.from('%PDF-1.4 fake'))),
  uploadBuffer: jest.fn(),
}));

const mockSendMessage = jest.fn(() => Promise.resolve({ success: true }));
const mockSendDocument = jest.fn(() => Promise.resolve({ success: true }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage,
  sendDocument: mockSendDocument,
}));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const CurriculumLpAstService = require('../../shared/services/curriculum-lp-ast.service');
const TopicMatchingService = require('../../shared/services/topic-matching.service');
const PreGenLookupService = require('../../shared/services/pregen-lookup.service');
const handleCurriculumLessonPlan = require('../../shared/handlers/lesson-plan-v2.handler');

const PHONE = '923333232533';
const USER_UUID = '2c0f4e08-1f6b-4a17-9c1a-3d31a5a5e5f9';

const NUMBER_BUDDIES_LP = {
  source_lp_uuid: 'b90d2456-b24e-4546-9e7a-96106ad933f6',
  chapter_number: 1,
  chapter_title: 'Number Buddies 0-9',
  lp_index: 2,
  topic: 'Numbers upto 9 (Concrete)',
  publisher: 'Taleemabad',
  grade: 1,
  subject: 'maths',
  curriculum_key: 'taleemabad',
  pdf_r2_key_en: null,
  pdf_r2_key_ur: null,
};

const CACHED_LP = { ...NUMBER_BUDDIES_LP, pdf_r2_key_en: 'lps/curriculum-ast/b90d2456.en.pdf' };
const CACHED_LP_UR = { ...NUMBER_BUDDIES_LP, pdf_r2_key_ur: 'lps/curriculum-ast/b90d2456.ur.pdf' };

describe('handleCurriculumLessonPlan — full-handler integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no legacy pre-gen match; specific tests can override
    TopicMatchingService.findChapterByTopic.mockResolvedValue(null);
    PreGenLookupService.findPreGenLP.mockResolvedValue(null);
  });

  // ─── Path 1: ast_cached (fast, synchronous) ────────────────────────────
  it('ast_cached — English cache hit serves R2 PDF synchronously', async () => {
    CurriculumLpAstService.findByTopic.mockResolvedValue(CACHED_LP);

    const result = await handleCurriculumLessonPlan({
      userId: PHONE, userDbId: USER_UUID,
      topic: 'number buddies', grade: 1, subject: 'maths',
      curriculum: 'taleemabad', language: 'en',
    });

    expect(result).toEqual({ source: 'ast_cached', promptedForPage: false });
    // R2 fetch + WhatsApp doc send, both synchronous
    expect(mockSendDocument).toHaveBeenCalledTimes(1);
    const [ toPhone, _tmpPath, filename ] = mockSendDocument.mock.calls[0];
    expect(toPhone).toBe(PHONE);
    expect(filename).toBe('Number Buddies 0-9 — Numbers upto 9 (Concrete) - Lesson Plan.pdf');
    // No queue, no ack
    expect(mockCreateAndQueueGrounded).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('ast_cached — Urdu cache hit uses pdf_r2_key_ur column', async () => {
    CurriculumLpAstService.findByTopic.mockResolvedValue(CACHED_LP_UR);

    const result = await handleCurriculumLessonPlan({
      userId: PHONE, userDbId: USER_UUID,
      topic: 'number buddies', grade: 1, subject: 'maths',
      curriculum: 'taleemabad', language: 'ur',
    });

    expect(result.source).toBe('ast_cached');
    expect(mockSendDocument).toHaveBeenCalledTimes(1);
    // Nothing queued
    expect(mockCreateAndQueueGrounded).not.toHaveBeenCalled();
  });

  // ─── Path 2: ast_queued (async render kicks off) ────────────────────────
  it('ast_queued — AST match but no cache: sends ack + queues job (English)', async () => {
    CurriculumLpAstService.findByTopic.mockResolvedValue(NUMBER_BUDDIES_LP); // no pdf_r2_key
    mockCreateAndQueueGrounded.mockResolvedValue('req-abc-123');

    const result = await handleCurriculumLessonPlan({
      userId: PHONE, userDbId: USER_UUID,
      topic: 'number buddies', grade: 1, subject: 'maths',
      curriculum: 'taleemabad', language: 'en',
    });

    expect(result).toEqual({ source: 'ast_queued', promptedForPage: false });

    // Ack sent in English
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [ ackPhone, ackBody ] = mockSendMessage.mock.calls[0];
    expect(ackPhone).toBe(PHONE);
    expect(ackBody).toMatch(/preparing your lesson plan/i);
    expect(ackBody).toContain('Numbers upto 9 (Concrete)');

    // Job queued with the AST context
    expect(mockCreateAndQueueGrounded).toHaveBeenCalledTimes(1);
    const [ queueArgs ] = mockCreateAndQueueGrounded.mock.calls[0];
    expect(queueArgs.userId).toBe(USER_UUID);
    expect(queueArgs.phoneNumber).toBe(PHONE);
    expect(queueArgs.sourceLpUuid).toBe(NUMBER_BUDDIES_LP.source_lp_uuid);
    expect(queueArgs.language).toBe('en');
    expect(queueArgs.chapterTitle).toBe('Number Buddies 0-9');

    // No synchronous PDF delivery — worker handles that
    expect(mockSendDocument).not.toHaveBeenCalled();
  });

  it('ast_queued — Urdu path: ack is Urdu, language routed to _ur', async () => {
    CurriculumLpAstService.findByTopic.mockResolvedValue(NUMBER_BUDDIES_LP);
    mockCreateAndQueueGrounded.mockResolvedValue('req-urdu');

    const result = await handleCurriculumLessonPlan({
      userId: PHONE, userDbId: USER_UUID,
      topic: 'number buddies', grade: 1, subject: 'maths',
      curriculum: 'taleemabad', language: 'ur',
    });

    expect(result.source).toBe('ast_queued');
    // Ack in Urdu — contains the Nastaliq word for "lesson plan" and the topic
    const [ , ackBody ] = mockSendMessage.mock.calls[0];
    expect(ackBody).toContain('لیسن پلان'); // "lesson plan" in Urdu
    expect(ackBody).toContain('Numbers upto 9 (Concrete)');

    // Language routed to Urdu
    expect(mockCreateAndQueueGrounded.mock.calls[0][0].language).toBe('ur');
  });

  it('ast_queued — ack send failure does NOT abort the queue (PDF delivery is what matters)', async () => {
    CurriculumLpAstService.findByTopic.mockResolvedValue(NUMBER_BUDDIES_LP);
    mockSendMessage.mockRejectedValueOnce(new Error('Meta 401'));
    mockCreateAndQueueGrounded.mockResolvedValue('req-recovered');

    const result = await handleCurriculumLessonPlan({
      userId: PHONE, userDbId: USER_UUID,
      topic: 'number buddies', grade: 1, subject: 'maths',
      curriculum: 'taleemabad', language: 'en',
    });

    // Job still queued despite failed ack
    expect(result.source).toBe('ast_queued');
    expect(mockCreateAndQueueGrounded).toHaveBeenCalledTimes(1);
  });

  // ─── Path 3: cache-miss without userDbId → fall through to freeform ────
  it('page_prompt — AST match + cache-miss + NO userDbId: cannot queue (needs UUID), falls through', async () => {
    CurriculumLpAstService.findByTopic.mockResolvedValue(NUMBER_BUDDIES_LP);

    const result = await handleCurriculumLessonPlan({
      userId: PHONE, /* NO userDbId */
      topic: 'number buddies', grade: 1, subject: 'maths',
      curriculum: 'taleemabad', language: 'en',
    });

    // Legacy pre-gen path also empty → page_prompt
    expect(result).toEqual({ source: 'page_prompt', promptedForPage: true });
    expect(mockCreateAndQueueGrounded).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // ─── Path 4: no matches at all → freeform Gamma ────────────────────────
  it('page_prompt — no AST match + no pre-gen match: falls through', async () => {
    CurriculumLpAstService.findByTopic.mockResolvedValue(null);
    TopicMatchingService.findChapterByTopic.mockResolvedValue(null);

    const result = await handleCurriculumLessonPlan({
      userId: PHONE, userDbId: USER_UUID,
      topic: 'photosynthesis in space', grade: 5, subject: 'science',
      curriculum: 'taleemabad', language: 'en',
    });

    expect(result).toEqual({ source: 'page_prompt', promptedForPage: true });
    expect(mockSendDocument).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockCreateAndQueueGrounded).not.toHaveBeenCalled();
  });

  // ─── Path 5: legacy Punjab pre_generated_lps still works ───────────────
  it('pre_generated — no AST match but pre-gen row exists: serves legacy PDF', async () => {
    CurriculumLpAstService.findByTopic.mockResolvedValue(null);
    TopicMatchingService.findChapterByTopic.mockResolvedValue({
      chapter_number: 3, chapter_title: 'Time to Recall',
    });
    PreGenLookupService.findPreGenLP.mockResolvedValue({
      pdf_r2_key_en: 'pre-gen/punjab/g1/eng/ch3.en.pdf',
    });

    const result = await handleCurriculumLessonPlan({
      userId: PHONE, userDbId: USER_UUID,
      topic: 'time to recall', grade: 1, subject: 'english',
      curriculum: 'punjab_snc_2020', language: 'en',
    });

    expect(result).toEqual({ source: 'pre_generated', promptedForPage: false });
    expect(mockSendDocument).toHaveBeenCalledTimes(1);
    expect(mockCreateAndQueueGrounded).not.toHaveBeenCalled();
  });

  // ─── Defensive: missing topic / curriculum ─────────────────────────────
  it('page_prompt when topic is missing', async () => {
    const result = await handleCurriculumLessonPlan({
      userId: PHONE, userDbId: USER_UUID,
      grade: 1, subject: 'maths', curriculum: 'taleemabad', language: 'en',
    });
    expect(result).toEqual({ source: 'page_prompt', promptedForPage: true });
  });

  it('page_prompt when curriculum is missing', async () => {
    const result = await handleCurriculumLessonPlan({
      userId: PHONE, userDbId: USER_UUID,
      topic: 'number buddies', grade: 1, subject: 'maths', language: 'en',
    });
    expect(result).toEqual({ source: 'page_prompt', promptedForPage: true });
  });

  it('unexpected AST service error falls through to freeform (no crash)', async () => {
    CurriculumLpAstService.findByTopic.mockRejectedValue(new Error('supabase 500'));

    const result = await handleCurriculumLessonPlan({
      userId: PHONE, userDbId: USER_UUID,
      topic: 'number buddies', grade: 1, subject: 'maths',
      curriculum: 'taleemabad', language: 'en',
    });

    expect(result).toEqual({ source: 'page_prompt', promptedForPage: true });
  });
});
