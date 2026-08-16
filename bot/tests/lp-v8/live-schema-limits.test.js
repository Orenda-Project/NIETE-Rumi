/**
 * FEAT-059 — the two limits the LIVE database actually imposes.
 *
 * Written after reading the live NIETE schema (2026-08-16), which the build
 * phase could not reach. Both of these are silent failures, not errors:
 *
 *  1. PostgREST on this project enforces db-max-rows = 1000. MEASURED, not
 *     assumed: GET /rest/v1/lesson_plan_catalog?select=id&limit=5000 returns
 *     exactly 1000 rows with Content-Range 0-999/*. A `.limit(5000)` therefore
 *     returns 1000 rows and NO error — so once the corpus passes 1,000 servable
 *     lessons (it is 2,038), the availability set silently truncates and whole
 *     grades vanish from the Flow with nothing in the logs.
 *
 *  2. lesson_plans.topic is VARCHAR(200) NOT NULL live. The delivery falls back
 *     to `lesson.topic` when `topic_short` is empty, and the raw corpus topics
 *     reach 211 code points (grade_1_urdu_ch6_seg6). That insert would throw,
 *     leaving the teacher with her PDF but no feedback survey — and the error
 *     swallowed as "non-fatal".
 *
 * The mock below models the server cap deliberately: a `.limit(n)` above the
 * cap returns cap rows, exactly as the live server does.
 */

const SERVER_MAX_ROWS = 1000; // measured on ihzciabopbttygxxgrkm, 2026-08-16

const mockTables = { niete_lp_assets: [], niete_lp_downloads: [], users: [], lesson_plans: [] };
const mockInserts = { niete_lp_downloads: [], lesson_plans: [] };
const rangeCalls = [];

function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const capped = (from = 0, to = null) => {
    const end = to == null ? from + SERVER_MAX_ROWS - 1 : Math.min(to, from + SERVER_MAX_ROWS - 1);
    return rows.slice(from, end + 1);
  };
  const b = {
    select: () => b,
    eq: (col, val) => { rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    in: (col, vals) => { rows = rows.filter((r) => vals.map(String).includes(String(r[col]))); return b; },
    order: () => b,
    // The server ignores the part of a limit that exceeds db-max-rows.
    limit: (n) => Promise.resolve({ data: rows.slice(0, Math.min(n, SERVER_MAX_ROWS)), error: null }),
    range: (from, to) => {
      rangeCalls.push([from, to]);
      return Promise.resolve({ data: capped(from, to), error: null });
    },
    single: () => Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } }),
    maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
    insert: (payload) => {
      const arr = Array.isArray(payload) ? payload : [payload];
      for (const p of arr) {
        // Model the column widths the live DB actually enforces.
        if (table === 'lesson_plans') {
          if (p.topic == null) throw new Error('null value in column "topic" violates not-null constraint');
          if (String(p.topic).length > 200) {
            throw new Error('value too long for type character varying(200)');
          }
        }
        const row = { id: `${table}-${(mockInserts[table] || []).length + 1}`, ...p };
        (mockInserts[table] = mockInserts[table] || []).push(row);
        mockTables[table] = [...(mockTables[table] || []), row];
      }
      const inserted = (mockInserts[table] || []).slice(-arr.length);
      const ret = {
        select: () => ret,
        single: () => Promise.resolve({ data: inserted[0], error: null }),
        then: (f, r) => Promise.resolve({ data: inserted, error: null }).then(f, r),
      };
      return ret;
    },
    update: () => b,
    then: (f, r) => Promise.resolve({ data: rows.slice(0, SERVER_MAX_ROWS), error: null }).then(f, r),
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));

jest.mock('../../shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((key) => `https://s3.example/bucket/${key}`),
  getPresignedUrl: jest.fn(async (url) => `${url}?X-Amz-Signature=deadbeef`),
}));

const mockSends = { docs: [], messages: [] };
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendDocumentByLink: jest.fn(async (phone, url, filename, caption) => {
    mockSends.docs.push({ phone, url, filename, caption });
    return { messages: [{ id: 'wamid.X' }] };
  }),
  sendMessage: jest.fn(async (phone, body) => { mockSends.messages.push({ phone, body }); return true; }),
}));

const mockFeedback = { scheduled: [] };
jest.mock('../../shared/services/lp-feedback.service', () => ({
  scheduleFeedbackPrompt: jest.fn((opts) => { mockFeedback.scheduled.push(opts); }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const V8Catalog = require('../../shared/services/lp-v8-catalog.service');
const Delivery = require('../../shared/services/lp-v8-delivery.service');

// A topic longer than the live VARCHAR(200). The real worst case in the corpus
// today is 211 code points (grade_1_urdu_ch6_seg6).
const LONG_TOPIC = `${'ا'.repeat(120)} ${'a'.repeat(120)}`;

const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 1 },
  books: [{
    stem: 'grade_1_urdu', grade: 1, subject: 'Urdu', subject_key: 'urdu', rtl: true,
    chapters: [{
      number: 6, title: 'باب ۶', title_short: 'باب ۶',
      lessons: [{
        lesson_id: 'grade_1_urdu_ch6_seg6', segment_index: 6, lp_type: 'content',
        day_label: 'Day 6', section: 'متن کا سفر', section_short: 'متن کا سفر',
        topic: LONG_TOPIC,
        topic_short: '',                       // empty → the code falls back to `topic`
        pages: [12], pages_label: 'p.12',
        row: { title: 'متن کا سفر', description: 'Day 6', metadata: '‎… · p.12' },
      }],
    }],
  }],
};

const ASSET = {
  id: 'asset-1',
  lesson_id: 'grade_1_urdu_ch6_seg6',
  asset_kind: 'lesson',
  catalog_version: 'v8',
  r2_key: 'lp-cache/v8/grade_1_urdu_ch6_seg6/aabbccddeeff.pdf',
  content_hash: 'aabbccddeeff',
  version_stamp: 'v8-20260816T1650',
  is_current: true,
};
const USER = { id: 'user-1', phone_number: '923001234567', preferred_language: 'ur' };

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  for (const k of Object.keys(mockTables)) mockTables[k] = [];
  for (const k of Object.keys(mockInserts)) mockInserts[k] = [];
  rangeCalls.length = 0;
  mockSends.docs = []; mockSends.messages = [];
  mockFeedback.scheduled = [];
});

describe('PostgREST db-max-rows = 1000 (measured live)', () => {
  test('availableLessonIds returns the WHOLE corpus, not the first 1000', async () => {
    // 2,038 is the real catalog size. The bug only appears above 1,000, which
    // is precisely when the Urdu renders land and the full upload runs.
    mockTables.niete_lp_assets = Array.from({ length: 2038 }, (_, i) => ({
      lesson_id: `lesson_${String(i).padStart(4, '0')}`,
      catalog_version: 'v8', asset_kind: 'lesson', is_current: true,
    }));

    const ids = await Delivery.availableLessonIds('v8');
    expect(ids.size).toBe(2038);
    expect(ids.has('lesson_0000')).toBe(true);
    expect(ids.has('lesson_2037')).toBe(true);
    // and it must get there by paging, not by asking for a limit the server ignores
    expect(rangeCalls.length).toBeGreaterThanOrEqual(3);
  });

  test('downloadedLessonIds pages too — a heavy teacher must not lose her ticks', async () => {
    mockTables.niete_lp_downloads = Array.from({ length: 1500 }, (_, i) => ({
      user_id: 'user-1', status: 'sent', lesson_id: `lesson_${String(i).padStart(4, '0')}`,
    }));
    const ids = await Delivery.downloadedLessonIds('user-1');
    expect(ids.size).toBe(1500);
    expect(ids.has('lesson_1499')).toBe(true);
  });

  test('a short set still costs exactly one round trip', async () => {
    mockTables.niete_lp_assets = Array.from({ length: 12 }, (_, i) => ({
      lesson_id: `lesson_${i}`, catalog_version: 'v8', asset_kind: 'lesson', is_current: true,
    }));
    const ids = await Delivery.availableLessonIds('v8');
    expect(ids.size).toBe(12);
    expect(rangeCalls).toHaveLength(1);
  });
});

describe('lesson_plans.topic is VARCHAR(200) NOT NULL live', () => {
  beforeEach(() => {
    mockTables.users = [USER];
    mockTables.niete_lp_assets = [ASSET];
  });

  test('a 241-code-point topic is clipped, not thrown away with the survey', async () => {
    expect(LONG_TOPIC.length).toBeGreaterThan(200);   // the premise of the test

    const res = await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_urdu_ch6_seg6' });
    expect(res.ok).toBe(true);

    const lp = mockInserts.lesson_plans[0];
    expect(lp).toBeDefined();                          // the insert must have happened
    expect(lp.topic.length).toBeLessThanOrEqual(200);
    expect(LONG_TOPIC.startsWith(lp.topic.replace(/…$/, ''))).toBe(true);

    // and because the row exists, the survey is schedulable
    expect(mockFeedback.scheduled).toHaveLength(1);
    expect(mockFeedback.scheduled[0].lessonPlanId).toBe(lp.id);
  });
});
