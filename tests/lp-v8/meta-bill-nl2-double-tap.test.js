'use strict';
/**
 * Meta bill cut NL2 (bd-w2daa.9): the same lesson tapped twice within two minutes is delivered once.
 *
 * The catalogue Flow's lesson row fires `deliverV8Lesson` fire-and-forget and nothing guarded it,
 * so a double tap sent the whole bundle twice — the "Preparing…" text, the PDF, the voice note,
 * and 30 s later a second survey. Production, 7 days: 811 cases of the same PDF to the same
 * teacher within 60 s, median gap 19.6 s, on DIFFERENT requests (~$209/month).
 *
 * The guard is a (user, lesson) claim with a 2-minute TTL taken in `selectLesson`, before the
 * delivery is started. Driven end to end — the REAL Flow endpoint into the REAL delivery service —
 * with only the network faked: Supabase (stateful, in memory), the cache, R2's presigner, WhatsApp.
 * The assertion is on what WhatsApp was asked to send.
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
  sendVoicenoteFromR2Key: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
// The coaching ask is lazily required and wrapped by the delivery; keep it out of this file's scope.
jest.mock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => ({ onLessonDelivered: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const EP = require('../../bot/shared/routes/pakistan-lp-endpoint');

const LESSON = 'grade_1_english_ch1_seg3';
const OTHER_LESSON = 'grade_1_english_ch1_seg4';
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
const asset = (lessonId) => ({
  id: `asset-${lessonId}`, lesson_id: lessonId, asset_kind: 'lesson', catalog_version: 'v8',
  r2_key: `lp-cache/v8/${lessonId}/aabb.pdf`, content_hash: 'aabb', version_stamp: 'v8-1', is_current: true,
});
const USERS = [
  { id: 'user-1', phone_number: '923001234567', preferred_language: 'en' },
  { id: 'user-2', phone_number: '923009999999', preferred_language: 'ur' },
];
const token = (userId) => `${userId}:pakistan-lp:${Date.now()}`;
const tap = (userId, lessonId) => EP.handlePakistanLpDataExchange(token(userId), 'SELECT_LESSON', { step: 'lesson', lesson: `V8-${lessonId}` });

/** The delivery runs fire-and-forget after SUCCESS returns; wait until it has gone quiet. */
async function settle() {
  for (let i = 0; i < 50; i += 1) await new Promise((r) => setImmediate(r));
}
const pdfsTo = (phone) => WhatsAppService.sendDocumentByLink.mock.calls.filter((c) => c[0] === phone);
const textsTo = (phone) => WhatsAppService.sendMessage.mock.calls.filter((c) => c[0] === phone).map((c) => c[1]);

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

let now;
beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.reset();
  mockDb.reset({ users: USERS, niete_lp_assets: [asset(LESSON), asset(OTHER_LESSON)], niete_lp_downloads: [], lesson_plans: [] });
  now = Date.parse('2026-10-01T09:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => { Date.now.mockRestore(); });

describe('a double tap on one lesson sends one bundle', () => {
  test('two taps 19 s apart → ONE "Preparing" text and ONE PDF; both taps still close the Flow on SUCCESS', async () => {
    const first = await tap('user-1', LESSON);
    await settle();
    now += 19_000;
    const second = await tap('user-1', LESSON);
    await settle();

    expect(first.screen).toBe('SUCCESS');
    expect(second.screen).toBe('SUCCESS');
    expect(pdfsTo('923001234567')).toHaveLength(1);
    expect(textsTo('923001234567')).toHaveLength(1);           // the one "Preparing…" line
    expect(WhatsAppService.sendVoicenoteFromR2Key).toHaveBeenCalledTimes(1);
    expect(mockDb.rows('niete_lp_downloads')).toHaveLength(1);
  });

  test('two taps in the same instant (the race) → still ONE PDF', async () => {
    await Promise.all([tap('user-1', LESSON), tap('user-1', LESSON)]);
    await settle();
    expect(pdfsTo('923001234567')).toHaveLength(1);
  });

  test('after the 2-minute window the same lesson is delivered again — a deliberate re-request works', async () => {
    await tap('user-1', LESSON);
    await settle();
    now += 121_000;
    await tap('user-1', LESSON);
    await settle();
    expect(pdfsTo('923001234567')).toHaveLength(2);
  });

  test('a DIFFERENT lesson inside the window is delivered — the guard is per lesson', async () => {
    await tap('user-1', LESSON);
    await settle();
    now += 5_000;
    await tap('user-1', OTHER_LESSON);
    await settle();
    expect(pdfsTo('923001234567')).toHaveLength(2);
  });

  test('a DIFFERENT teacher tapping the same lesson is delivered — the guard is per teacher', async () => {
    await tap('user-1', LESSON);
    await tap('user-2', LESSON);
    await settle();
    expect(pdfsTo('923001234567')).toHaveLength(1);
    expect(pdfsTo('923009999999')).toHaveLength(1);
  });

  test('a FAILED first delivery releases the claim — the retry is not swallowed', async () => {
    WhatsAppService.sendDocumentByLink.mockResolvedValueOnce(null);   // Meta refused the PDF
    await tap('user-1', LESSON);
    await settle();
    now += 10_000;
    await tap('user-1', LESSON);
    await settle();
    expect(pdfsTo('923001234567')).toHaveLength(2);
    expect(mockDb.rows('niete_lp_downloads').map((r) => r.status)).toEqual(['failed', 'sent']);
  });

  test('a cache that cannot answer never costs the teacher the lesson (fail open)', async () => {
    mockRedis.setNX.mockRejectedValueOnce(new Error('ECONNRESET'));
    await tap('user-1', LESSON);
    await settle();
    expect(pdfsTo('923001234567')).toHaveLength(1);
  });
});
