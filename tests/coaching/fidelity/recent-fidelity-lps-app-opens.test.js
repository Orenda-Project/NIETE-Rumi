'use strict';
/**
 * The "Recent Lesson Plans" pick after a self-recording (WhatsApp list) and the app's Coaching Home
 * list both read getRecentFidelityLps. It read niete_lp_downloads only — the WhatsApp delivery
 * ledger — so a teacher who now reads her plans in the teacher app was offered stale plans or none,
 * and the fidelity link (Section B) measured her lesson against the wrong plan.
 *
 * The list now also reads her app viewer opens through lp-app-opens.store (the asset the app served
 * her at the open), merged with her WhatsApp deliveries newest-first, one row per lesson.
 *
 * Driven through the REAL service, the REAL lp-app-opens.store and the REAL catalogue; only the
 * database is faked (in memory).
 */

const { createMemorySupabase } = require('../../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
jest.mock('../../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));

const { logToFile } = require('../../../bot/shared/utils/logger');
const V8Catalog = require('../../../bot/shared/services/lp-v8-catalog.service');
const { getRecentFidelityLps } = require('../../../bot/shared/services/coaching/lp-coaching/recent-fidelity-lps.service');

const lessonRow = (i) => ({
  lesson_id: `grade_1_english_ch1_seg${i}`, segment_index: i, lp_type: 'content',
  day_label: `Day ${i}`, section: 'Diving Deeper', section_short: 'Diving Deeper',
  topic: `Topic ${i}`, topic_short: `Topic ${i}`, pages: [i], pages_label: `p.${i}`,
  row: { title: 'Diving Deeper', description: `Day ${i}`, metadata: `Topic ${i} · p.${i}` },
});
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 3 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{ number: 1, title: 'Hello World!', title_short: 'Hello World!', lessons: [lessonRow(3), lessonRow(4), lessonRow(5)] }],
  }],
};
const L3 = 'grade_1_english_ch1_seg3';
const L4 = 'grade_1_english_ch1_seg4';
const L5 = 'grade_1_english_ch1_seg5';
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const NOW = new Date('2026-10-13T06:00:00Z');
const ago = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

const assetRow = (lessonId, ver, createdAt, over = {}) => ({
  id: `asset-${lessonId}-${ver}`, lesson_id: lessonId, asset_kind: 'lesson', version_stamp: ver,
  content_hash: `h-${ver}`, is_current: false, superseded_at: null, created_at: createdAt, ...over,
});
const download = (lessonId, at, ver = 'v1') => ({
  id: `d-${lessonId}-${at}`, user_id: TEACHER, lesson_id: lessonId, asset_id: `asset-${lessonId}-${ver}`,
  version_stamp: ver, content_hash: `h-${ver}`, grade: '1', subject: 'english', chapter_number: 1,
  status: 'sent', created_at: at,
});
const open = (id, lessonId, at, over = {}) => ({
  id, user_id: TEACHER, plan_kind: 'k5', plan_ref: lessonId, lang: null, source: 'viewer', opened_at: at, ...over,
});

function seed(extra = {}) {
  mockDb.reset({
    niete_lp_assets: [
      // L3: v1 superseded by v2 two days ago — an open yesterday was served v2
      assetRow(L3, 'v1', ago(24 * 30), { superseded_at: ago(48) }),
      assetRow(L3, 'v2', ago(48), { is_current: true }),
      assetRow(L4, 'v1', ago(24 * 30), { is_current: true }),
      assetRow(L5, 'v1', ago(24 * 30), { is_current: true }),
    ],
    // her last WhatsApp delivery was a week ago
    niete_lp_downloads: [download(L4, ago(24 * 7))],
    niete_lp_opens: [open('o-1', L3, ago(20))],
    app_settings: [],
    ...extra,
  });
}

let savedEnv;
beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));
beforeEach(() => {
  savedEnv = { ...process.env };
  delete process.env.COACHING_ASK_COUNT_APP_OPENS;
  delete process.env.LP_QUIZ_COUNT_APP_OPENS;
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
  jest.setSystemTime(NOW);
  seed();
});
afterEach(() => {
  jest.useRealTimers();
  process.env = savedEnv;
});

describe('the recent list includes a plan read in the app', () => {
  test('an app-read plan newer than every WhatsApp delivery is listed first, as the version the app served', async () => {
    const out = await getRecentFidelityLps(TEACHER);
    expect(out.map((r) => r.lesson_id)).toEqual([L3, L4]);
    expect(out[0]).toMatchObject({
      id: `asset-${L3}-v2`, asset_id: `asset-${L3}-v2`, version_stamp: 'v2', content_hash: 'h-v2',
      topic: 'Topic 3', day_label: 'Day 3', pages_label: 'p.3', chapter_number: 1, created_at: ago(20),
    });
  });

  test('a lesson taken both ways is listed once, at its newest use', async () => {
    mockDb.rows('niete_lp_downloads').push(download(L3, ago(30)));
    const out = await getRecentFidelityLps(TEACHER);
    expect(out.map((r) => r.lesson_id)).toEqual([L3, L4]);
    expect(out[0].created_at).toBe(ago(20));
  });

  test('a WhatsApp delivery newer than the app open stays first', async () => {
    mockDb.rows('niete_lp_downloads').push(download(L5, ago(2)));
    const out = await getRecentFidelityLps(TEACHER);
    expect(out.map((r) => r.lesson_id)).toEqual([L5, L3, L4]);
  });

  // bd-2wgr3d.22.1 — operator 14 Oct: a hand-off only ever starts inside the app; it is a plan taken.
  test("a plan handed from the app to another app ('external') is listed like a viewer open", async () => {
    mockDb.rows('niete_lp_opens')[0].source = 'external';
    const out = await getRecentFidelityLps(TEACHER);
    expect(out.map((r) => r.lesson_id)).toEqual([L3, L4]);
  });

  test('the row budget still holds across both sources', async () => {
    const out = await getRecentFidelityLps(TEACHER, { limit: 1 });
    expect(out.map((r) => r.lesson_id)).toEqual([L3]);
  });
});

describe('switches and failures', () => {
  // bd-2wgr3d.22.1 — no switch on the fix: the app link is the only on/off.
  test('COACHING_ASK_COUNT_APP_OPENS=off changes nothing: app-read plans are still listed', async () => {
    process.env.COACHING_ASK_COUNT_APP_OPENS = 'off';
    const out = await getRecentFidelityLps(TEACHER);
    expect(out.map((r) => r.lesson_id)).toEqual([L3, L4]);
  });

  test('the quiz offer\'s own switch (LP_QUIZ_COUNT_APP_OPENS=off) does not empty this list', async () => {
    process.env.LP_QUIZ_COUNT_APP_OPENS = 'off';
    const out = await getRecentFidelityLps(TEACHER);
    expect(out.map((r) => r.lesson_id)).toEqual([L3, L4]);
  });

  test('an app-open read that fails still lists her WhatsApp deliveries, and says so at error level', async () => {
    const before = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementation((table) => {
      const b = before(table);
      if (table !== 'niete_lp_opens') return b;
      b.limit = async () => ({ data: null, error: { message: 'connection reset' } });
      return b;
    });
    try {
      const out = await getRecentFidelityLps(TEACHER);
      expect(out.map((r) => r.lesson_id)).toEqual([L4]);
      expect(logToFile.mock.calls.some((c) => c[2] === 'error')).toBe(true);
    } finally {
      mockDb.from.mockImplementation(before);
    }
  });
});
