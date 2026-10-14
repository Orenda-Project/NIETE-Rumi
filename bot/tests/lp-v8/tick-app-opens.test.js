/**
 * The ✓ "you have this lesson" tick counts a lesson the teacher opened in the teacher app.
 *
 * Two lists carry the tick: the WhatsApp Flow's lesson list (pakistan-lp-endpoint → v8LessonScreen)
 * and the teacher app's lesson list (lp-v8-browse.listLessons → `downloaded`). Both read
 * lp-v8-delivery.downloadedLessonIds, which counted WhatsApp deliveries only
 * (niete_lp_downloads, status 'sent'). Since the app became the place a K-5 plan is read, most
 * plans are opened in the app's viewer (niete_lp_opens, plan_kind 'k5', source 'viewer') and the
 * lesson showed ○ on both lists although she has it.
 *
 * What is real here: the Flow endpoint, the browse service, the delivery service, the app-open
 * store, the A/B service and the catalogue (a test catalogue). Mocked: the database client, the
 * WhatsApp client, R2 and the loggers.
 */

/* eslint-disable global-require */

const mockTables = {};
const mockReadErrors = {};
const mockQueries = [];
function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const q = { table, filters: [], orders: [] };
  mockQueries.push(q);
  const result = () => (mockReadErrors[table]
    ? { data: null, error: { message: mockReadErrors[table] } }
    : { data: rows, error: null });
  const b = {
    select: (cols) => { q.select = cols; return b; },
    eq: (col, val) => { q.filters.push(['eq', col, val]); rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    gte: (col, val) => { rows = rows.filter((r) => String(r[col]) >= String(val)); return b; },
    lt: (col, val) => { rows = rows.filter((r) => String(r[col]) < String(val)); return b; },
    in: (col, vals) => { rows = rows.filter((r) => vals.map(String).includes(String(r[col]))); return b; },
    order: (col, opts) => {
      q.orders.push([col, opts]);
      const asc = !opts || opts.ascending !== false;
      rows = [...rows].sort((a, c) => (asc ? 1 : -1) * String(a[col]).localeCompare(String(c[col])));
      return b;
    },
    limit: (n) => { q.limit = n; rows = rows.slice(0, n); return b; },
    range: (from, to) => { q.range = [from, to]; return Promise.resolve(result()).then((r) => (r.error ? r : { data: r.data.slice(from, to + 1), error: null })); },
    maybeSingle: () => {
      const r = result();
      return Promise.resolve(r.error ? r : { data: (r.data || [])[0] || null, error: null });
    },
    single: () => Promise.resolve({ data: rows[0] || null, error: null }),
    then: (f, r) => Promise.resolve(result()).then(f, r),
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));
jest.mock('../../shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((k) => `https://r2.example/${k}`),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
}));

const V8Catalog = require('../../shared/services/lp-v8-catalog.service');
const EP = require('../../shared/routes/pakistan-lp-endpoint');
const Browse = require('../../shared/services/lp-v8-browse.service');
const { logToFile } = require('../../shared/utils/logger');

const lesson = (i, extra = {}) => ({
  lesson_id: `grade_1_english_ch1_seg${i}`,
  segment_index: i, lp_type: 'content', day_label: `Day ${i}`,
  section: 'Memory Lane', section_short: 'Memory Lane',
  topic: `Topic ${i}`, topic_short: `Topic ${i}`, pages: [i], pages_label: `p.${i}`,
  row: { title: 'Memory Lane', description: `Day ${i}`, metadata: `Topic ${i} · p.${i}` },
  ...extra,
});
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 5 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{
      // Chapter 1 is outside the A/B scope (chapters 3-8): the list is today's list for every group.
      number: 1, title: 'Hello World!', title_short: 'Hello World!',
      lessons: [1, 2, 3, 4].map((i) => lesson(i)).concat([lesson(5, { lp_type: 'assessment' })]),
    }],
  }],
};
const ID = (i) => `grade_1_english_ch1_seg${i}`;
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = `${USER}:flow-token`;

const open = (userId, ref, extra = {}) => ({
  id: `open-${userId}-${ref}-${extra.source || 'viewer'}-${extra.plan_kind || 'k5'}`,
  user_id: userId, plan_kind: 'k5', plan_ref: ref, source: 'viewer', lang: null,
  opened_at: '2026-10-13T05:00:00.000Z', ...extra,
});

const ENV = 'LP_TICK_COUNT_APP_OPENS';
const saved = process.env[ENV];
afterAll(() => { if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved; });

beforeEach(() => {
  delete process.env[ENV];
  V8Catalog.__setCatalogForTests(CATALOG);
  Object.keys(mockTables).forEach((k) => delete mockTables[k]);
  Object.keys(mockReadErrors).forEach((k) => delete mockReadErrors[k]);
  mockQueries.length = 0;
  logToFile.mockClear();
  mockTables.niete_lp_assets = [1, 2, 3, 4, 5].map((i) => ({
    lesson_id: ID(i), catalog_version: 'v8', asset_kind: 'lesson', is_current: true,
  }));
  // seg3 reached her on WhatsApp; seg2 only in the app's viewer.
  mockTables.niete_lp_downloads = [{ user_id: USER, lesson_id: ID(3), status: 'sent' }];
  mockTables.niete_lp_opens = [open(USER, ID(2))];
  mockTables.app_settings = [];
});

/** The Flow's lesson list, asked for the way Meta asks: a data_exchange with step 'chapter'. */
async function flowTicks(token = TOKEN) {
  const res = await EP.handlePakistanLpDataExchange(token, 'SELECT_CHAPTER', {
    step: 'chapter', grade: '1', subject: 'english', chapter: '1',
  });
  return Object.fromEntries(res.data.items.map((it) => [it.id.replace(/^V8-/, ''), it['main-content'].title[0]]));
}
async function appTicks(userId = USER) {
  const rows = await Browse.listLessons(1, 'english', 1, userId);
  return Object.fromEntries(rows.map((r) => [r.lesson_id, r.downloaded]));
}
const opensQueries = () => mockQueries.filter((q) => q.table === 'niete_lp_opens');

describe('a lesson known only from a viewer open is ✓', () => {
  test('the WhatsApp Flow lesson list ticks it', async () => {
    const t = await flowTicks();
    expect(t[ID(2)]).toBe(V8Catalog.DONE_TICK);   // app-opened only
    expect(t[ID(3)]).toBe(V8Catalog.DONE_TICK);   // WhatsApp delivery, as before
    expect(t[ID(1)]).toBe(V8Catalog.TODO_TICK);
    expect(t[ID(4)]).toBe(V8Catalog.TODO_TICK);
  });

  test('the app lesson list marks it downloaded', async () => {
    const t = await appTicks();
    expect(t[ID(2)]).toBe(true);
    expect(t[ID(3)]).toBe(true);
    expect(t[ID(1)]).toBe(false);
  });
});

describe('only her own K-5 viewer opens count', () => {
  test('an external-app link, a 6-12 open and another teacher\'s open do not tick', async () => {
    mockTables.niete_lp_opens = [
      open(USER, ID(1), { source: 'external' }),
      open(USER, ID(4), { plan_kind: 'g612' }),
      open(OTHER, ID(2)),
    ];
    const t = await appTicks();
    expect(t[ID(1)]).toBe(false);
    expect(t[ID(4)]).toBe(false);
    expect(t[ID(2)]).toBe(false);
    expect(t[ID(3)]).toBe(true);
  });

  test('an assessment opened in the viewer ticks its lesson id — the answer key logs the same id (today\'s rule)', async () => {
    // The viewer route logs the lesson id for ?kind=answer_key exactly as for the worksheet, and a
    // WhatsApp delivery of an assessment (worksheet + key) records the same one lesson id.
    mockTables.niete_lp_opens = [open(USER, ID(5))];
    const t = await flowTicks();
    expect(t[ID(5)]).toBe(V8Catalog.DONE_TICK);
  });
});

describe('the read (Class R): one capped, indexed per-teacher read per render', () => {
  test('one niete_lp_opens query per list render: her id, k5, viewer, newest first, capped', async () => {
    await flowTicks();
    expect(opensQueries()).toHaveLength(1);
    const q = opensQueries()[0];
    expect(q.select).toBe('plan_ref');
    expect(q.filters).toEqual(expect.arrayContaining([
      ['eq', 'user_id', USER], ['eq', 'plan_kind', 'k5'], ['eq', 'source', 'viewer'],
    ]));
    expect(q.orders[0]).toEqual(['opened_at', { ascending: false }]);
    expect(q.limit).toBe(1000);
  });

  test('a read error on the opens keeps every WhatsApp tick and logs it', async () => {
    mockReadErrors.niete_lp_opens = 'boom';
    const t = await appTicks();
    expect(t[ID(3)]).toBe(true);
    expect(t[ID(2)]).toBe(false);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/app opens/i), expect.objectContaining({ error: expect.stringMatching(/boom/) }), 'error');
  });
});

describe(`kill switch ${ENV}`, () => {
  test.each(['false', '0', 'off', 'no'])('%s → byte-identical to WhatsApp deliveries only, and no opens read', async (v) => {
    const opens = mockTables.niete_lp_opens;
    mockTables.niete_lp_opens = [];
    process.env[ENV] = 'false';
    const flowBaseline = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', { step: 'chapter', grade: '1', subject: 'english', chapter: '1' });
    const appBaseline = await Browse.listLessons(1, 'english', 1, USER);

    mockTables.niete_lp_opens = opens;
    mockQueries.length = 0;
    process.env[ENV] = v;
    const flowOff = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', { step: 'chapter', grade: '1', subject: 'english', chapter: '1' });
    const appOff = await Browse.listLessons(1, 'english', 1, USER);
    expect(JSON.stringify(flowOff)).toBe(JSON.stringify(flowBaseline));
    expect(JSON.stringify(appOff)).toBe(JSON.stringify(appBaseline));
    expect(opensQueries()).toHaveLength(0);
  });

  test('unset is on', async () => {
    expect((await appTicks())[ID(2)]).toBe(true);
  });
});

describe('the WhatsApp Flow payload caps are unchanged', () => {
  test('a ticked title is the same length as an unticked one (one code point either way)', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', { step: 'chapter', grade: '1', subject: 'english', chapter: '1' });
    const items = res.data.items;
    expect(items).toHaveLength(5);
    for (const it of items) {
      expect([...it['main-content'].title].length).toBeLessThanOrEqual(V8Catalog.TITLE_CAP);
    }
    const byId = Object.fromEntries(items.map((it) => [it.id, it['main-content'].title]));
    expect([...byId[`V8-${ID(2)}`]].length).toBe([...byId[`V8-${ID(1)}`]].length);
  });
});
