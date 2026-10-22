'use strict';
/**
 * bd-4joiqz (second commit) — a LEADER reading a grades 1-5 plan in the portal gets the plan their school's teachers
 * get, and leaves no trace that reads as a teacher's ask.
 *
 * POST /api/internal/lp/v8/pdf takes `{ userId, reader: 'leader' }` from the portal (which decides the role from
 * `users`). The asset is picked by the reader's SCHOOL exactly as for a teacher there — the ch3-8 A/B group and the
 * v10 coaching test's plan arm (a B/D school's card) — but:
 *
 *   no lifecycle row        recordPortalLesson is not called: a leader reading is not a teacher's ask
 *   no lp.v10.plan_served   that event counts plans served to DRAWN TEACHERS; a leader's read is not one
 *
 * A coach has no school, so a coach gets today's default plan. A teacher's fetch is unchanged, and any `reader` other
 * than 'leader' is ignored.
 *
 * Driven through the REAL route, the REAL browse service, the REAL v10 card service, arms and switch, and the REAL
 * lifecycle writer; faked: Supabase (in memory), R2 signing, and the log sinks.
 */

const { createMemorySupabase } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockEvents = [];
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((k) => `https://s3.example/bucket/${k}`),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (event, data) => mockEvents.push({ event, data }),
  getCurrentCorrelationId: () => undefined,
}));

const KEY = 'internal-test-key';
process.env.INTERNAL_API_KEY = KEY;

const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const V10Switch = require('../../bot/shared/services/coaching/ab-v10-switch');
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
  r2_key: `lp-cache/v8/${LESSON}/v9.pdf`, content_hash: 'h9', version_stamp: 'v8-1', is_current: true,
};
const CARD = {
  id: 'a-card', lesson_id: LESSON, asset_kind: 'card', catalog_version: 'v8',
  r2_key: `lp-cache/v10/${LESSON}/card.pdf`, content_hash: 'hc', version_stamp: 'v10-1', is_current: true,
};
const PRINCIPAL = '2b3c4d5e-0b8d-4c55-9a51-2d7f0e3b9c12';
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const COACH = '1a2b3c4d-0b8d-4c55-9a51-2d7f0e3b9c11';

function findRoute(method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`route ${method.toUpperCase()} ${path} not found`);
}
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

const served = () => mockEvents.filter((e) => e.event === 'lp.v10.plan_served');
const asks = () => mockDb.rows('lesson_plan_requests');

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // The portal ask's lifecycle row is ON here, so its absence for a leader is a real absence.
  process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
  process.env.REGION = 'niete';
  mockEvents.length = 0;
  V10Switch._resetCache();
  mockDb.reset({
    app_settings: [{ key: 'ab_v10_enabled', value: true }],
    niete_coaching_ab_assignment: [{ school_id: 'school-b', ab_group: 'B' }],
    users: [
      { id: PRINCIPAL, role: 'principal', school_id: 'school-b', phone_number: '923001110005', preferred_language: 'en' },
      { id: TEACHER, role: 'teacher', school_id: 'school-b', phone_number: '923001110001', preferred_language: 'en' },
      { id: COACH, role: 'coach', school_id: null, phone_number: '923001110004', preferred_language: 'en' },
    ],
    niete_lp_assets: [V9, CARD],
    lesson_plan_requests: [],
    lesson_plans: [],
  });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('a leader reading a grades 1-5 plan', () => {
  test('a principal of a plan-arm (B) school: the v10 CARD their teachers get — and no plan_served event, no lifecycle row', async () => {
    const { statusCode, payload } = await fetchPdf({ lessonId: LESSON, userId: PRINCIPAL, reader: 'leader' });
    expect(statusCode).toBe(200);
    expect(payload).toEqual(expect.objectContaining({ success: true, available: true }));
    expect(payload.url).toContain(CARD.r2_key);
    expect(served()).toEqual([]);
    expect(asks()).toHaveLength(0);
  });

  test('a coach (no school): today\'s default v9 plan — no event, no row', async () => {
    const { payload } = await fetchPdf({ lessonId: LESSON, userId: COACH, reader: 'leader' });
    expect(payload.url).toContain(V9.r2_key);
    expect(served()).toEqual([]);
    expect(asks()).toHaveLength(0);
  });
});

describe('a teacher\'s fetch is unchanged (golden)', () => {
  test('a teacher of the same B school: the card, ONE plan_served event and ONE lifecycle row', async () => {
    const { payload } = await fetchPdf({ lessonId: LESSON, userId: TEACHER });
    expect(payload.url).toContain(CARD.r2_key);
    expect(served()).toHaveLength(1);
    expect(served()[0].data).toEqual(expect.objectContaining({ userId: TEACHER, lessonId: LESSON, channel: 'app', group: 'B', plan: 'v10', served: 'card' }));
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toEqual(expect.objectContaining({ user_id: TEACHER, channel: 'portal', status: 'completed' }));
  });

  test('a `reader` other than "leader" is ignored: a teacher fetch', async () => {
    const { payload } = await fetchPdf({ lessonId: LESSON, userId: TEACHER, reader: 'admin' });
    expect(payload.url).toContain(CARD.r2_key);
    expect(served()).toHaveLength(1);
    expect(asks()).toHaveLength(1);
  });
});
