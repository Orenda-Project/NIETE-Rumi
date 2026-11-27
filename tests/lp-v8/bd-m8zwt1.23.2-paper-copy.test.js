'use strict';
/**
 * bd-m8zwt1.23.2 (queue #377) — a grades 1-5 plan's PAPER copy, behind the app's Print.
 *
 * Since q372 the plan a teacher reads in the app is cut for a phone (270 pt wide pages): printed on paper it comes
 * out as a narrow column. A PDF has one shape, so the A4 copy is a second file beside it in R2, at the same key with
 * `.paper.pdf` for `.pdf` (paperKey). POST /api/internal/lp/v8/pdf takes `paper: true` and signs that file when it is
 * there; when it is not (a day nobody re-made, a site where none was uploaded), the plan itself, so Print always opens
 * something. Without `paper`, exactly today's call: no extra R2 lookup.
 *
 * Driven through the REAL route and browse service; faked: Supabase (in memory), R2 (head + signing), log sinks.
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockHead = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((k) => `https://s3.example/bucket/${k}`),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
  headObject: (...a) => mockHead(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));

const KEY = 'internal-test-key';
process.env.INTERNAL_API_KEY = KEY;

const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const V10Switch = require('../../bot/shared/services/coaching/ab-v10-switch');
const Browse = require('../../bot/shared/services/lp-v8-browse.service');
const router = require('../../bot/shared/routes/internal-api.routes');

const LESSON = 'grade_1_english_ch1_seg3';
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 1 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{ number: 1, title: 'Hello World!', title_short: 'Hello World!', lessons: [{
      lesson_id: LESSON, segment_index: 3, lp_type: 'content', day_label: 'Day 3', section: 'S', section_short: 'S',
      topic: 'Topic 3', topic_short: 'Topic 3', pages: [3], pages_label: 'p.3', row: { title: 'S', description: 'D', metadata: 'M' },
    }] }],
  }],
};
const V9 = {
  id: 'a-v9', lesson_id: LESSON, asset_kind: 'lesson', catalog_version: 'v8',
  r2_key: `lp-cache/v8/${LESSON}/h9.pdf`, content_hash: 'h9', version_stamp: 'v8-1', is_current: true,
};
const CARD = {
  id: 'a-card', lesson_id: LESSON, asset_kind: 'card', catalog_version: 'v8',
  r2_key: `lp-cache/v8/${LESSON}/hc.card.pdf`, content_hash: 'hc', version_stamp: 'v10-1', is_current: true,
};
const TEACHER_B = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';   // a plan-arm school: the card
const COACH = '1a2b3c4d-0b8d-4c55-9a51-2d7f0e3b9c11';       // no school: the v9 full plan

async function fetchPdf(body) {
  const layer = router.stack.find((l) => l.route && l.route.methods.post && l.route.path === '/lp/v8/pdf');
  const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path: '/lp/v8/pdf' };
  let payload = null;
  const res = { status() { return this; }, json(b) { payload = b; return this; } };
  for (const h of layer.route.stack.map((s) => s.handle)) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await h(req, res, () => { next = true; });
    if (!next) break;
  }
  return payload;
}

const paperThere = (keys) => mockHead.mockImplementation(async (k) => ({ exists: keys.includes(k) }));

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));
beforeEach(() => {
  mockHead.mockReset();
  V10Switch._resetCache();
  require('../../bot/shared/services/lp-v10-card.service')._resetServedLog();
  mockDb.reset({
    app_settings: [{ key: 'ab_v10_enabled', value: true }],
    niete_coaching_ab_assignment: [{ school_id: 'school-b', ab_group: 'B' }],
    users: [
      { id: TEACHER_B, role: 'teacher', school_id: 'school-b', phone_number: '923001110001', preferred_language: 'en' },
      { id: COACH, role: 'coach', school_id: null, phone_number: '923001110004', preferred_language: 'en' },
    ],
    niete_lp_assets: [V9, CARD],
    lesson_plan_requests: [],
    lesson_plans: [],
  });
});

test('paperKey: the same key, .paper.pdf for .pdf', () => {
  expect(Browse.paperKey('lp-cache/v8/x/hc.card.pdf')).toBe('lp-cache/v8/x/hc.card.paper.pdf');
  expect(Browse.paperKey('lp-cache/v8/x/h9.pdf')).toBe('lp-cache/v8/x/h9.paper.pdf');
});

test('Print on a card day: the card\'s A4 copy', async () => {
  paperThere(['lp-cache/v8/grade_1_english_ch1_seg3/hc.card.paper.pdf']);
  const p = await fetchPdf({ lessonId: LESSON, userId: TEACHER_B, paper: true });
  expect(p.url).toBe('https://s3.example/bucket/lp-cache/v8/grade_1_english_ch1_seg3/hc.card.paper.pdf?sig=1');
});

test('Print on a full plan: its paper copy', async () => {
  paperThere(['lp-cache/v8/grade_1_english_ch1_seg3/h9.paper.pdf']);
  const p = await fetchPdf({ lessonId: LESSON, userId: COACH, reader: 'leader', paper: true });
  expect(p.url).toContain('h9.paper.pdf');
});

test('Print with no paper copy: the plan itself, never nothing', async () => {
  paperThere([]);
  const p = await fetchPdf({ lessonId: LESSON, userId: TEACHER_B, paper: true });
  expect(p).toEqual(expect.objectContaining({ available: true }));
  expect(p.url).toBe(`https://s3.example/bucket/${CARD.r2_key}?sig=1`);
});

test('Print when R2 cannot be asked: the plan itself', async () => {
  mockHead.mockRejectedValue(new Error('r2 down'));
  const p = await fetchPdf({ lessonId: LESSON, userId: TEACHER_B, paper: true });
  expect(p.url).toBe(`https://s3.example/bucket/${CARD.r2_key}?sig=1`);
});

test('no paper: today\'s call, no R2 lookup', async () => {
  const p = await fetchPdf({ lessonId: LESSON, userId: TEACHER_B });
  expect(p.url).toBe(`https://s3.example/bucket/${CARD.r2_key}?sig=1`);
  expect(mockHead).not.toHaveBeenCalled();
});
