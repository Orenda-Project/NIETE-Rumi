'use strict';
/**
 * The topic-end nudge (bd-pw1ccr.4) is booked from both places a plan is "taken".
 *
 *  1. WhatsApp: the REAL Flow endpoint into the REAL v8 delivery service. A delivered lesson calls
 *     TopicEndNudge.onLessonDelivered with who, which lesson and when, beside the coaching ask.
 *     A nudge that throws never costs the teacher the PDF.
 *  2. The app: POST /lp/open-survey hands the same open to TopicEndNudge.onAppOpen, and its
 *     decision rides back as `topicNudge`. A throw there still answers 200.
 *
 * The nudge service itself is mocked: its decisions are covered by topic-end-nudge.test.js.
 */

const { PassThrough } = require('stream');
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
jest.mock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => ({
  onLessonDelivered: jest.fn(), onAppOpen: jest.fn().mockResolvedValue({ outcome: 'skipped', reason: 'disabled' }),
}));
jest.mock('../../bot/shared/services/lp-app-open-survey.service', () => ({
  onViewerOpen: jest.fn().mockResolvedValue({ outcome: 'skipped', reason: 'disabled' }),
}));
jest.mock('../../bot/shared/services/nudges/topic-end-nudge.service', () => ({
  onLessonDelivered: jest.fn().mockResolvedValue({ scheduled: false, reason: 'disabled' }),
  onAppOpen: jest.fn().mockResolvedValue({ scheduled: false, reason: 'disabled' }),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const TopicEndNudge = require('../../bot/shared/services/nudges/topic-end-nudge.service');
const EP = require('../../bot/shared/routes/pakistan-lp-endpoint');
const router = require('../../bot/shared/routes/internal-api.routes');

const LESSON = 'grade_1_english_ch1_seg3';
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 1 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{
      number: 1, title: 'Hello World!', title_short: 'Hello World!',
      lessons: [{
        lesson_id: LESSON, segment_index: 3, lp_type: 'content', day_label: 'Day 3', section: 'Diving Deeper',
        section_short: 'Diving Deeper', topic: 'Topic 3', topic_short: 'Topic 3', pages: [3], pages_label: 'p.3',
        row: { title: 'Diving Deeper', description: 'Day 3', metadata: 'Topic 3 · p.3' },
      }],
    }],
  }],
};
const ASSET = {
  id: `asset-${LESSON}`, lesson_id: LESSON, asset_kind: 'lesson', catalog_version: 'v8',
  r2_key: `lp-cache/v8/${LESSON}/aabb.pdf`, content_hash: 'aabb', version_stamp: 'v8-1', is_current: true,
};
const TEACHER = { id: 'user-1', phone_number: '923001234567', preferred_language: 'ur' };
const OPEN_ID = '11111111-1111-4111-8111-000000000001';

const tap = () => EP.handlePakistanLpDataExchange(
  `${TEACHER.id}:pakistan-lp:${Date.now()}`, 'SELECT_LESSON', { step: 'lesson', lesson: `V8-${LESSON}` },
);
async function settle() {
  for (let i = 0; i < 60; i += 1) await new Promise((r) => setImmediate(r));
}

async function postOpen(openId) {
  const layer = router.stack.find((l) => l.route && l.route.methods.post && l.route.path === '/lp/open-survey');
  const handlers = layer.route.stack.map((s) => s.handle);
  const res = new PassThrough();
  res.statusCode = 200;
  res.status = (c) => { res.statusCode = c; return res; };
  let body = null;
  res.json = (b) => { body = b; return res; };
  await handlers[handlers.length - 1]({ body: { openId }, headers: {} }, res);
  return { status: res.statusCode, body };
}

let savedRegion;
beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));
beforeEach(() => {
  savedRegion = process.env.REGION;
  process.env.REGION = 'niete';
  jest.clearAllMocks();
  mockRedis.reset();
  mockDb.reset({ users: [TEACHER], niete_lp_assets: [ASSET], niete_lp_downloads: [], lesson_plans: [], lesson_plan_requests: [] });
});
afterEach(() => {
  if (savedRegion === undefined) delete process.env.REGION; else process.env.REGION = savedRegion;
});

describe('a lesson delivered on WhatsApp books the topic-end nudge', () => {
  test('called once with the teacher, the lesson, the time and the asset kind', async () => {
    await tap();
    await settle();
    expect(WhatsAppService.sendDocumentByLink).toHaveBeenCalled();
    expect(TopicEndNudge.onLessonDelivered).toHaveBeenCalledTimes(1);
    const [args] = TopicEndNudge.onLessonDelivered.mock.calls[0];
    expect(args).toMatchObject({ userId: TEACHER.id, lessonId: LESSON, assetKind: 'lesson' });
    expect(Number.isFinite(Date.parse(args.deliveredAt))).toBe(true);
  });

  test('a nudge that throws never costs the teacher the PDF', async () => {
    TopicEndNudge.onLessonDelivered.mockRejectedValueOnce(new Error('boom'));
    await tap();
    await settle();
    expect(WhatsAppService.sendDocumentByLink).toHaveBeenCalledTimes(1);
    expect(mockDb.rows('niete_lp_downloads')).toHaveLength(1);
  });
});

describe('a plan read in the app books the topic-end nudge', () => {
  test('the open id is handed over and the decision rides back as topicNudge', async () => {
    TopicEndNudge.onAppOpen.mockResolvedValueOnce({ scheduled: true, nudgeDate: '2026-10-29' });
    const out = await postOpen(OPEN_ID);
    expect(out.status).toBe(200);
    expect(TopicEndNudge.onAppOpen).toHaveBeenCalledWith({ openId: OPEN_ID });
    expect(out.body).toMatchObject({ success: true, topicNudge: { scheduled: true } });
  });

  test('a nudge that throws still answers 200, with the survey and the coaching ask intact', async () => {
    TopicEndNudge.onAppOpen.mockRejectedValueOnce(new Error('boom'));
    const out = await postOpen(OPEN_ID);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      success: true, coachingAsk: { reason: 'disabled' }, topicNudge: { scheduled: false, reason: 'guard_unavailable' },
    });
  });
});
