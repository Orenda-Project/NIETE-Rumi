'use strict';
/**
 * A grade 1-5 lesson plan handed to the PORTAL / teacher app leaves its lifecycle row — and the plan
 * row the app-open survey hangs off names it.
 *
 * WHY. Since 12 Oct 2026 a registered teacher who asks for a plan on WhatsApp is sent into the
 * teacher app, and reads it there: the portal asks the bot for the lesson's PDF
 * (POST /api/internal/lp/v8/pdf) and shows it. That is now where most NIETE plans reach a teacher,
 * and it wrote no lesson_plan_requests row at all — the analyst could not see a single one.
 *
 * THE RULE. With LP_LIFECYCLE_PATHS on for niete_v8_segment, a lesson PDF handed to the portal for a
 * named teacher is one ask, channel 'portal': completed when the PDF was there, failed NO_ASSET when it
 * was not. An answer key is not a lesson plan ask. A second fetch of the same lesson by the same
 * teacher within five minutes is the same ask (a re-render, a double tap, the viewer falling back to
 * another app — the portal's own open log counts it once for the same reason). The row is written
 * AFTER the answer goes back, so the portal's open never waits on it.
 *
 * Driven through the REAL route, the REAL catalogue lookup, the REAL lifecycle writer and the REAL
 * app-open survey; only the network is faked (R2, WhatsApp; Supabase and the cache in memory).
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
  sendDocumentByLink: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => ({ onLessonDelivered: jest.fn() }));

const KEY = 'internal-test-key';
process.env.INTERNAL_API_KEY = KEY;

const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const AppSurvey = require('../../bot/shared/services/lp-app-open-survey.service');
const router = require('../../bot/shared/routes/internal-api.routes');

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
const OTHER_LESSON = 'grade_1_english_ch1_seg4'; // in the catalogue, no asset uploaded
const asset = (lessonId) => ({
  id: `asset-${lessonId}`, lesson_id: lessonId, asset_kind: 'lesson', catalog_version: 'v8',
  r2_key: `lp-cache/v8/${lessonId}/aabb.pdf`, content_hash: 'aabb', version_stamp: 'v8-1', is_current: true,
});
const USER = { id: '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', phone_number: '923001234567', preferred_language: 'ur' };
const NOW = new Date('2026-10-13T09:00:00Z');

function findRoute(method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`route ${method.toUpperCase()} ${path} not found`);
}
/** POST /lp/v8/pdf through the real middleware + handler; resolves once the handler has finished. */
async function fetchPdf(body) {
  const stack = findRoute('post', '/lp/v8/pdf');
  const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path: '/lp/v8/pdf' };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const asks = () => mockDb.rows('lesson_plan_requests');
const touched = (table) => mockDb.from.mock.calls.filter((c) => c[0] === table).length;

// lesson_plans: the real table mints the id (the survey's button id needs one).
const realFrom = mockDb.from.getMockImplementation();
let planSeq = 0;
mockDb.from.mockImplementation((table) => {
  const b = realFrom(table);
  if (table !== 'lesson_plans') return b;
  const insert = b.insert;
  b.insert = (p) => insert({ id: `00000000-0000-4000-8000-${String((planSeq += 1)).padStart(12, '0')}`, ...p });
  return b;
});

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  process.env.REGION = 'niete';
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
  jest.setSystemTime(NOW);
  mockRedis.reset();
  mockDb.reset({
    users: [USER],
    niete_lp_assets: [asset(LESSON)],
    lesson_plan_requests: [],
    lesson_plans: [],
    lp_feedback: [],
    niete_lp_opens: [],
    niete_lp_downloads: [],
    niete_lp612_deliveries: [],
    chat_sessions: [{ id: 'cs-1', user_id: USER.id, last_activity_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() }],
  });
});
afterEach(() => {
  jest.useRealTimers();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('a grade 1-5 lesson PDF handed to the portal', () => {
  test('switched ON: ONE completed row — channel portal, her phone and language from users — and the answer unchanged', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
    const { statusCode, payload } = await fetchPdf({ lessonId: LESSON, userId: USER.id });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({
      success: true, available: true, url: expect.stringContaining(asset(LESSON).r2_key), asset_kind: 'lesson', version_stamp: 'v8-1',
    });
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toEqual(expect.objectContaining({
      user_id: USER.id, phone_number: '923001234567', language: 'ur', status: 'completed', source: 'niete_v8_segment',
      channel: 'portal', region: 'niete', grade: 1, subject: 'english', topic: 'Topic 3', artifact_ref: LESSON,
      created_at: NOW.toISOString(), generated_at: NOW.toISOString(), error_code: null,
    }));
    expect(asks()[0].delivered_at).toBeTruthy();
  });

  test('switched ON: a lesson with no PDF yet → ONE failed row, NO_ASSET; the answer is still "not available"', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
    const { payload } = await fetchPdf({ lessonId: OTHER_LESSON, userId: USER.id });
    expect(payload).toEqual({ success: true, available: false });
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toEqual(expect.objectContaining({
      status: 'failed', error_code: 'NO_ASSET', channel: 'portal', artifact_ref: OTHER_LESSON, delivered_at: null, topic: 'Topic 4',
    }));
  });

  test('switched ON: a lesson id the catalogue does not know is not an ask — no row, and not even a read of the lifecycle table', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
    const { statusCode, payload } = await fetchPdf({ lessonId: 'grade_1_english_ch9_seg99', userId: USER.id });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, available: false });
    expect(asks()).toHaveLength(0);
    expect(touched('lesson_plan_requests')).toBe(0);
  });

  test('switched ON: the same lesson fetched again within 5 minutes is the same ask — after that it is a new one', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
    await fetchPdf({ lessonId: LESSON, userId: USER.id });
    jest.setSystemTime(new Date(NOW.getTime() + 2 * 60_000));
    await fetchPdf({ lessonId: LESSON, userId: USER.id, assetKind: 'lesson' });
    expect(asks()).toHaveLength(1);
    jest.setSystemTime(new Date(NOW.getTime() + 6 * 60_000));
    await fetchPdf({ lessonId: LESSON, userId: USER.id });
    expect(asks()).toHaveLength(2);
  });

  test('switched ON: a PDF that cannot be signed → 500 as before, and ONE failed row (DELIVERY_FAILED)', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
    require('../../bot/shared/storage/r2').getPresignedUrl.mockRejectedValueOnce(new Error('R2 sign failed'));
    const { statusCode, payload } = await fetchPdf({ lessonId: LESSON, userId: USER.id });
    expect(statusCode).toBe(500);
    expect(payload).toEqual(expect.objectContaining({ success: false }));
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'DELIVERY_FAILED', channel: 'portal' }));
  });

  test('switched ON: a catalogue lookup that throws while recording never reaches the route', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
    const Lookup = require('../../bot/shared/services/lp-v8-lifecycle.service');
    const spy = jest.spyOn(V8Catalog, 'lessonById');
    // the route's own lookup (inside the browse service) succeeds; the recorder's lookup throws
    spy.mockImplementationOnce((...a) => jest.requireActual('../../bot/shared/services/lp-v8-catalog.service').lessonById(...a));
    spy.mockImplementationOnce(() => { throw new Error('catalogue corrupt'); });
    await expect(Lookup.recordPortalLesson({ userId: USER.id, lessonId: LESSON, available: true, askedAt: NOW.toISOString() }))
      .resolves.toBeNull();
    spy.mockRestore();
  });

  test('switched ON: an answer key, or a fetch with no teacher named, is not a lesson-plan ask', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
    await fetchPdf({ lessonId: LESSON, userId: USER.id, assetKind: 'answer_key' });
    await fetchPdf({ lessonId: LESSON });
    expect(asks()).toHaveLength(0);
  });

  test('switched OFF: the same answer, and the lifecycle tables are never touched', async () => {
    const { payload } = await fetchPdf({ lessonId: LESSON, userId: USER.id });
    expect(payload).toEqual({
      success: true, available: true, url: expect.stringContaining(asset(LESSON).r2_key), asset_kind: 'lesson', version_stamp: 'v8-1',
    });
    expect(asks()).toHaveLength(0);
    expect(touched('lesson_plan_requests')).toBe(0);
    expect(touched('users')).toBe(0);
  });
});

describe('the plan she then reads in the app — the survey\'s plan row names her ask', () => {
  const openRow = { id: 'open-1', user_id: USER.id, plan_kind: 'k5', plan_ref: LESSON, lang: null, source: 'viewer' };

  test('switched ON: the lesson_plans row the survey hangs off carries her portal ask\'s request_id', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
    await fetchPdf({ lessonId: LESSON, userId: USER.id });
    const [ask] = asks();
    jest.setSystemTime(new Date(NOW.getTime() + 20_000));
    mockDb.rows('niete_lp_opens').push({ ...openRow, opened_at: new Date(NOW.getTime() + 15_000).toISOString() });
    const out = await AppSurvey.onViewerOpen({ openId: 'open-1' });
    expect(out).toMatchObject({ outcome: 'scheduled' });
    const [plan] = mockDb.rows('lesson_plans');
    expect(plan).toEqual(expect.objectContaining({ user_id: USER.id, request_id: ask.id }));
  });

  test('switched OFF: the plan row is exactly the old one — no request_id key', async () => {
    await fetchPdf({ lessonId: LESSON, userId: USER.id });
    mockDb.rows('niete_lp_opens').push({ ...openRow, opened_at: new Date(NOW.getTime() + 15_000).toISOString() });
    await AppSurvey.onViewerOpen({ openId: 'open-1' });
    const [plan] = mockDb.rows('lesson_plans');
    expect(plan).toBeTruthy();
    expect(plan).not.toHaveProperty('request_id');
  });
});
