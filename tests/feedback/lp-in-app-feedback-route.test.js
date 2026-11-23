'use strict';
/**
 * The bot's internal routes behind the in-app survey bar:
 *   POST /api/internal/lp/feedback        { userId, kind, ref, lang?, useful?, usedInClass?, reasonText? }
 *   POST /api/internal/lp/feedback/state  { userId, kind, ref } → { feedback: null | { useful, usedInClass } }
 * and the app-open survey told that the bar is on for her (`inApp: true`): no WhatsApp survey for that open, while the
 * same open still books what it books today (the coaching ask, the topic-end nudge).
 *
 * Driven through the REAL routes and services; only the database, the cache and WhatsApp are in memory.
 */

const { PassThrough } = require('stream');
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase({});
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
  sendReaction: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
  sendTemplateMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const router = require('../../bot/shared/routes/internal-api.routes');

const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 1 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{ number: 1, title: 'Hello', title_short: 'Hello', lessons: [{
      lesson_id: 'grade_1_english_ch1_seg3', segment_index: 3, lp_type: 'content', day_label: 'Day 3',
      section: 'Diving Deeper', section_short: 'Diving Deeper', topic: 'Topic 3', topic_short: 'Topic 3',
      pages: [3], pages_label: 'p.3', row: { title: 'Diving Deeper', description: 'Day 3', metadata: 'Topic 3' },
    }] }],
  }],
};
const LESSON = 'grade_1_english_ch1_seg3';
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const OPEN = '11111111-1111-4111-8111-000000000001';

const realFrom = mockDb.from.getMockImplementation();
let planSeq = 0;
mockDb.from.mockImplementation((table) => {
  const b = realFrom(table);
  if (table !== 'lesson_plans') return b;
  const insert = b.insert;
  b.insert = (p) => insert({ id: `00000000-0000-4000-8000-${String((planSeq += 1)).padStart(12, '0')}`, ...p });
  return b;
});

function route(path) {
  const layer = router.stack.find((l) => l.route && l.route.methods.post && l.route.path === path);
  if (!layer) throw new Error(`route POST ${path} not found`);
  return layer.route.stack.map((s) => s.handle);
}

/** Past the key check: the handler the portal reaches. */
async function post(path, body) {
  const handlers = route(path);
  const res = new PassThrough();
  res.statusCode = 200;
  res.status = (c) => { res.statusCode = c; return res; };
  let out = null;
  res.json = (b) => { out = b; return res; };
  await handlers[handlers.length - 1]({ body, headers: {} }, res);
  return { status: res.statusCode, body: out };
}

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));
beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.reset();
  mockDb.reset({
    users: [{ id: TEACHER, phone_number: '920000000000', preferred_language: 'en', role: 'teacher', last_message_at: new Date().toISOString() }],
    niete_lp_assets: [], lesson_plans: [], lp_feedback: [], niete_lp_downloads: [], niete_lp612_deliveries: [],
    teacher_nudges: [], coaching_sessions: [], niete_lp612_segments: [],
    niete_lp_opens: [{ id: OPEN, user_id: TEACHER, plan_kind: 'k5', plan_ref: LESSON, lang: null, source: 'viewer', opened_at: new Date().toISOString() }],
  });
});

describe('POST /lp/feedback', () => {
  test('both routes sit behind the internal key', () => {
    for (const p of ['/lp/feedback', '/lp/feedback/state']) {
      expect(route(p).length).toBeGreaterThan(1);
      expect(route(p)[0].name).toBe('requireInternalKey');
    }
  });

  test('a bad body is 400 and writes nothing', async () => {
    expect((await post('/lp/feedback', { userId: 'nope', kind: 'k5', ref: LESSON, useful: true })).status).toBe(400);
    expect((await post('/lp/feedback', { userId: TEACHER, kind: 'k5', ref: LESSON })).status).toBe(400);
    expect(mockDb.rows('lp_feedback')).toHaveLength(0);
  });

  test('a first tap saves an in_app row; the next first tap is already_answered; In class updates it', async () => {
    const first = await post('/lp/feedback', { userId: TEACHER, kind: 'k5', ref: LESSON, useful: true });
    expect(first).toEqual({ status: 200, body: { success: true, outcome: 'saved', feedback: { useful: true, usedInClass: null } } });
    const again = await post('/lp/feedback', { userId: TEACHER, kind: 'k5', ref: LESSON, useful: true });
    expect(again.body).toMatchObject({ success: true, outcome: 'already_answered' });
    const inClass = await post('/lp/feedback', { userId: TEACHER, kind: 'k5', ref: LESSON, usedInClass: 'taught' });
    expect(inClass.body.feedback).toEqual({ useful: true, usedInClass: 'taught' });
    expect(mockDb.rows('lp_feedback')).toHaveLength(1);
    expect(mockDb.rows('lp_feedback')[0]).toMatchObject({ trigger_mode: 'in_app', used_in_class: 'taught' });
  });

  test('an unknown plan is 404; an In class with no first tap is 409', async () => {
    expect((await post('/lp/feedback', { userId: TEACHER, kind: 'k5', ref: 'grade_9_x', useful: true })).status).toBe(404);
    expect((await post('/lp/feedback', { userId: TEACHER, kind: 'k5', ref: LESSON, usedInClass: 'taught' })).status).toBe(409);
  });

  test('a database that cannot answer is 500, never saved', async () => {
    mockDb.from.mockImplementationOnce(() => { throw new Error('down'); });
    const out = await post('/lp/feedback', { userId: TEACHER, kind: 'k5', ref: LESSON, useful: true });
    expect(out.status).toBe(500);
    expect(out.body.success).toBe(false);
  });
});

describe('POST /lp/feedback/state', () => {
  test('null before she answers, her answer after; 400 on a bad body', async () => {
    expect((await post('/lp/feedback/state', { userId: TEACHER, kind: 'k5', ref: LESSON })).body).toEqual({ success: true, feedback: null });
    await post('/lp/feedback', { userId: TEACHER, kind: 'k5', ref: LESSON, useful: false });
    expect((await post('/lp/feedback/state', { userId: TEACHER, kind: 'k5', ref: LESSON })).body)
      .toEqual({ success: true, feedback: { useful: false, usedInClass: null } });
    expect((await post('/lp/feedback/state', { userId: TEACHER, kind: 'fln', ref: '1' })).status).toBe(400);
  });
});

describe('the app-open survey when the bar is on for her', () => {
  test('inApp: the WhatsApp survey is skipped (in_app_bar), the rest of the open still runs', async () => {
    const out = await post('/lp/open-survey', { openId: OPEN, inApp: true });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ success: true, outcome: 'skipped', reason: 'in_app_bar' });
    expect(out.body.coachingAsk).toBeDefined();
    expect(out.body.topicNudge).toBeDefined();
    expect(logEvent).toHaveBeenCalledWith('lp.app_open_survey', expect.objectContaining({ reason: 'in_app_bar', openId: OPEN }));
    expect(mockDb.rows('lesson_plans')).toHaveLength(0);
  });
});
