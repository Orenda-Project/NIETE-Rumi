'use strict';
/**
 * Meta bill cut NL4 / N2-L04 (bd-w2daa.9): one survey per lesson per ten minutes.
 *
 * Every v8 delivery writes its own `lesson_plans` row and schedules its own "Was it useful?"
 * prompt 30 s later. A teacher who receives the same lesson twice within ten minutes was asked
 * the identical question twice — 914 such repeat deliveries in 7 days on production. The second
 * ask carries no new information (the teacher is rating the same lesson) and is a billed message.
 *
 * The rule: at SEND time (the delayed callback, so the delivery itself pays nothing), a
 * (teacher, lesson) claim with a 10-minute TTL; a second prompt for a lesson already asked about
 * inside the window is skipped. A prompt that failed to send releases the claim. A caller that
 * does not name its lesson (`context.lessonKey` absent) is untouched.
 *
 * Driven through the REAL v8 delivery and the REAL survey service on the fake clock; only the
 * network is faked (WhatsApp, R2's presigner, Supabase and the cache in memory).
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
  sendDocumentByLink: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.DOC' }] }),
  sendVoicenoteFromR2Key: jest.fn().mockResolvedValue(false),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => ({ onLessonDelivered: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const Delivery = require('../../bot/shared/services/lp-v8-delivery.service');
const LpFeedback = require('../../bot/shared/services/lp-feedback.service');

const lessonRow = (i) => ({
  lesson_id: `grade_1_english_ch1_seg${i}`, segment_index: i, lp_type: 'content',
  day_label: `Day ${i}`, section: 'Diving Deeper', section_short: 'Diving Deeper',
  topic: `Topic ${i}`, topic_short: `Topic ${i}`, pages: [i], pages_label: `p.${i}`,
  row: { title: 'Diving Deeper', description: `Day ${i}`, metadata: `Topic ${i} · p.${i}` },
});
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 2 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{ number: 1, title: 'Hello World!', title_short: 'Hello World!', lessons: [lessonRow(3), lessonRow(4)] }],
  }],
};
const LESSON = 'grade_1_english_ch1_seg3';
const OTHER = 'grade_1_english_ch1_seg4';
const asset = (lessonId) => ({
  id: `asset-${lessonId}`, lesson_id: lessonId, asset_kind: 'lesson', catalog_version: 'v8',
  r2_key: `lp-cache/v8/${lessonId}/aabb.pdf`, content_hash: 'aabb', version_stamp: 'v8-1', is_current: true,
});
const USER = { id: 'user-1', phone_number: '923001234567', preferred_language: 'ur' };

const surveys = () => WhatsAppService.sendInteractiveButtons.mock.calls
  .map((c) => c[1])
  .filter((p) => p && p.buttons && /^lp_feedback_yes_/.test(p.buttons[0].id));

const deliver = (lessonId) => Delivery.deliverV8Lesson({ userId: USER.id, lessonId });
const minutes = (n) => jest.advanceTimersByTimeAsync(n * 60_000);

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
  jest.setSystemTime(new Date('2026-10-01T09:00:00Z'));
  mockRedis.reset();
  mockDb.reset({ users: [USER], niete_lp_assets: [asset(LESSON), asset(OTHER)], niete_lp_downloads: [], lesson_plans: [] });
});
afterEach(() => { jest.useRealTimers(); });

describe('the same lesson delivered twice inside ten minutes is surveyed once', () => {
  test('re-delivered 3 minutes later → TWO PDFs (asked for twice) but ONE survey', async () => {
    await deliver(LESSON);
    await minutes(3);
    await deliver(LESSON);
    await minutes(1);

    expect(WhatsAppService.sendDocumentByLink).toHaveBeenCalledTimes(2);
    expect(surveys()).toHaveLength(1);
    expect(surveys()[0].body).toMatch(/[؀-ۿ]/);   // still in the teacher's language
  });

  test('re-delivered 11 minutes later → asked again (the window is ten minutes)', async () => {
    await deliver(LESSON);
    await minutes(11);
    await deliver(LESSON);
    await minutes(1);
    expect(surveys()).toHaveLength(2);
  });

  test('two DIFFERENT lessons inside the window → both asked about', async () => {
    await deliver(LESSON);
    await minutes(2);
    await deliver(OTHER);
    await minutes(1);
    expect(surveys()).toHaveLength(2);
  });

  test('a prompt that failed to send does not block the next one', async () => {
    WhatsAppService.sendInteractiveButtons.mockResolvedValueOnce(false);
    await deliver(LESSON);
    await minutes(3);
    await deliver(LESSON);
    await minutes(1);
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(2);
  });

  test('a caller that names no lesson (other LP doors) keeps today\'s behaviour — asked each time', async () => {
    const opts = (id) => ({ lessonPlanId: id, userId: USER.id, phone: USER.phone_number, context: { topic: 'Same topic' } });
    LpFeedback.scheduleFeedbackPrompt(opts('11111111-1111-4111-8111-111111111111'));
    LpFeedback.scheduleFeedbackPrompt(opts('22222222-2222-4222-8222-222222222222'));
    await minutes(1);
    expect(surveys()).toHaveLength(2);
  });

  test('a cache that cannot answer never costs the teacher the survey (fail open)', async () => {
    mockRedis.setNX.mockRejectedValue(new Error('ECONNRESET'));
    try {
      await deliver(LESSON);
      await minutes(1);
    } finally {
      mockRedis.setNX.mockReset();
    }
    expect(surveys()).toHaveLength(1);
  });
});
