'use strict';
/**
 * A typed ask served a PRE-GENERATED chapter names that chapter on its lifecycle row: artifact_ref is
 * the pre_generated_lps row's id.
 *
 * The row's topic is her own words ("grade 1 english time to recall"), so artifact_ref is the only
 * place the record says WHICH chapter she was sent. On the sandbox (2026-10-14) a live ask left it
 * NULL: the handler passes `preGen.id`, and the lookup never selected `id`. The older case in
 * grounded-path.test.js missed it because it mocked the lookup and handed back a row WITH an id —
 * a shape the real query cannot return. Here the real lookup runs against the in-memory database,
 * which returns only the columns a query names (projectSelect), the way PostgREST does.
 *
 * Faked: the network (WhatsApp, R2, the survey timer), the database (in memory), and the two
 * curriculum lookups that decide which path runs — the AST lookup misses so the pre-generated path
 * is taken, and the chapter match is given. The pre-generated lookup itself is real.
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase({}, { projectSelect: true });
const mockEvent = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/queue', () => ({ queueCoachingJob: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockEvent(...a),
  getCurrentCorrelationId: () => 'corr-typed-1',
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendDocument: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 pregen')),
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/services/oxbridge-lp.service', () => ({ isEligibleGrade: () => false }));
jest.mock('../../bot/shared/services/curriculum-lp-ast.service', () => ({
  findByTopic: jest.fn().mockResolvedValue(null),
  findByUuid: jest.fn(),
  setRenderedPdfKey: jest.fn(),
}));
jest.mock('../../bot/shared/services/topic-matching.service', () => ({
  findChapterByTopic: jest.fn().mockResolvedValue({ chapter_number: 1, chapter_title: 'Time to Recall' }),
}));
jest.mock('../../bot/shared/services/feature-linker.service', () => ({ checkAndSuggest: jest.fn(), suggestNext: jest.fn() }));
jest.mock('../../bot/shared/services/feature-registration.service', () => ({ checkAndTriggerRegistration: jest.fn() }));

const handleCurriculumLessonPlan = require('../../bot/shared/handlers/lesson-plan-v2.handler');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const PHONE = '923001234567';
// The sandbox's one pre-generated chapter, as the table holds it.
const PREGEN = {
  id: 'acf38258-c01d-4350-88ba-e7cc93a0b7d8', curriculum: 'punjab_snc_2020', grade: 1, subject: 'english',
  chapter_number: 1, chapter_title: 'Time to Recall', is_current: true, generation_status: 'completed',
  pdf_r2_key_en: 'lps/v7/chapters/english/g1/ch01.pdf', pdf_r2_key_ur: null,
  gamma_url_en: null, gamma_url_ur: null,
};

const ask = () => handleCurriculumLessonPlan({
  userId: PHONE, userDbId: TEACHER, topic: 'grade 1 english time to recall',
  grade: 1, subject: 'english', curriculum: 'punjab_snc_2020', language: 'en',
});

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.REGION = 'niete';
  process.env.LP_LIFECYCLE_PATHS = 'pre_gen_chapter';
  jest.clearAllMocks();
  mockDb.reset({
    pre_generated_lps: [PREGEN], lesson_plan_requests: [], lesson_plans: [],
    users: [{ id: TEACHER, phone_number: PHONE }],
  });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

test('the in-memory database returns only the columns a query names (what makes this test able to fail)', async () => {
  const { data } = await mockDb.from('pre_generated_lps').select('pdf_r2_key_en, generation_status').eq('grade', 1).single();
  expect(Object.keys(data).sort()).toEqual(['generation_status', 'pdf_r2_key_en']);
});

test('a typed ask served the pre-generated chapter: ONE completed row whose artifact_ref is that chapter\'s id', async () => {
  const res = await ask();
  expect(res.source).toBe('pre_generated');
  const rows = mockDb.rows('lesson_plan_requests');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual(expect.objectContaining({
    status: 'completed', source: 'pre_gen_chapter', channel: 'whatsapp', grade: 1, subject: 'english',
    artifact_ref: PREGEN.id,
  }));
  expect(mockEvent).toHaveBeenCalledWith('lesson_plan.delivery.sent', expect.objectContaining({
    requestId: rows[0].id, artifactRef: PREGEN.id,
  }));
});
