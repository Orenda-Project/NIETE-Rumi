'use strict';
/**
 * bd-h7nsmx — a grades 1-5 plan opened through the 6-12 route gets the grades 1-5 survey.
 *
 * The portal's /lp612/status and /lp612/file routes also serve a teacher's own grades 1-5 plan
 * ("Make my own") and shelf plans, and record every open there as plan_kind 'g612'. The ref is then a
 * K-5 catalogue lesson id (grade_5_social_studies_en_ch5_seg21). The app-open survey sent such an open
 * to the 6-12 survey, whose tap inserts lp_feedback.lp612_segment_id = <K-5 id>, which the foreign key
 * to niete_lp612_segments refuses: on NIETE live ~17 thumbs a day were lost (queue #144, 18 Nov 2026).
 *
 * The rule: the REF decides the band. A 'g612' open whose ref is a grades 1-5 catalogue lesson is
 * surveyed exactly as a 'k5' open is — a lesson_plans row, lp_feedback linked by lesson_plan_id.
 */

const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockRedis = createMemoryRedis();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((k) => `https://s3.example/bucket/${k}`),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => ({ onLessonDelivered: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const LpFeedback = require('../../bot/shared/services/lp-feedback.service');
const AppSurvey = require('../../bot/shared/services/lp-app-open-survey.service');

const LESSON = 'grade_1_english_ch1_seg3';
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 1 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{ number: 1, title: 'Hello World!', title_short: 'Hello World!', lessons: [{
      lesson_id: LESSON, segment_index: 3, lp_type: 'content', day_label: 'Day 3', section: 'Diving Deeper',
      section_short: 'Diving Deeper', topic: 'Topic 3', topic_short: 'Topic 3', pages: [3], pages_label: 'p.3',
      row: { title: 'Diving Deeper', description: 'Day 3', metadata: 'Topic 3 · p.3' },
    }] }],
  }],
};
const USER = { id: '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', phone_number: '923001234567', preferred_language: 'en' };
const NOW = new Date('2026-11-18T09:00:00Z');

// What the portal's 6-12 route records for her own grades 1-5 plan.
const k5OpenAsG612 = { id: 'open-1', user_id: USER.id, plan_kind: 'g612', plan_ref: LESSON, lang: 'en', source: 'viewer', opened_at: NOW.toISOString() };

const surveys = () => WhatsAppService.sendInteractiveButtons.mock.calls
  .map((c) => c[1])
  .filter((p) => p && p.buttons && /^(lp_feedback_yes_|lp612_fb_yes_)/.test(p.buttons[0].id));

const realFrom = mockDb.from.getMockImplementation();
let planSeq = 0;
mockDb.from.mockImplementation((table) => {
  const b = realFrom(table);
  if (table !== 'lesson_plans') return b;
  const insert = b.insert;
  b.insert = (p) => insert({ id: `00000000-0000-4000-8000-${String((planSeq += 1)).padStart(12, '0')}`, ...p });
  return b;
});

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
  jest.setSystemTime(NOW);
  mockRedis.reset();
  mockDb.reset({
    users: [USER],
    niete_lp_assets: [],
    niete_lp_downloads: [],
    niete_lp612_deliveries: [],
    niete_lp612_segments: [],
    lesson_plans: [],
    lp_feedback: [],
    niete_lp_opens: [{ ...k5OpenAsG612 }],
    chat_sessions: [{ id: 'cs-1', user_id: USER.id, last_activity_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() }],
  });
});
afterEach(() => { jest.useRealTimers(); });

describe('a grades 1-5 lesson recorded as a 6-12 open', () => {
  test('she is asked the grades 1-5 survey, never the 6-12 one', async () => {
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'scheduled' });
    await jest.advanceTimersByTimeAsync(31_000);
    expect(surveys()).toHaveLength(1);
    expect(surveys()[0].buttons[0].id).toMatch(/^lp_feedback_yes_[0-9a-f-]{36}$/);
  });

  test('her 👍 is saved, linked by lesson_plan_id, with no 6-12 segment id', async () => {
    await AppSurvey.onViewerOpen({ openId: 'open-1' });
    await jest.advanceTimersByTimeAsync(31_000);
    await LpFeedback.handleFeedbackButton(surveys()[0].buttons[0].id, USER.phone_number);

    const [plan] = mockDb.rows('lesson_plans');
    const fb = mockDb.rows('lp_feedback');
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ user_id: USER.id, lesson_plan_id: plan.id, useful: true, grade: 1, subject: 'english' });
    expect(fb[0].lp612_segment_id == null).toBe(true);
  });

  test('a lesson already sent to her on WhatsApp (grades 1-5 ledger) is not asked again', async () => {
    mockDb.rows('niete_lp_downloads').push({ id: 'd1', user_id: USER.id, lesson_id: LESSON, status: 'sent' });
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'delivered_on_whatsapp' });
  });
});
