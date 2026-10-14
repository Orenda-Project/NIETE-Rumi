/**
 * The call's lesson lookup sees the lesson plans a teacher read in the teacher app.
 *
 * `findLessons` deliberately resolves lessons the same way the chat's lesson context does. The chat
 * now also reads the teacher's K-5 app viewer opens (niete_lp_opens, plan_kind 'k5', source
 * 'viewer'); the call read only niete_lp_downloads, so a teacher asking on a call about the plan
 * she read in the app was told nothing was delivered.
 *
 * What is real here: the call tools (lookup_lesson), call-tools.repo (findLessons +
 * readLessonScript), lp-context's app-open read, the app-open store, the switch module and the A/B
 * service. Mocked: the database client, R2 (the voicenote script), the move-list store and the
 * catalogue.
 */

/* eslint-disable global-require */

jest.mock('../../shared/services/lp-voicenote-script.service', () => ({
  getVoicenoteScript: jest.fn(async (entry) => (entry && entry.r2_key ? `SCRIPT FOR ${entry.r2_key}` : null)),
}));

let mockMoveLists = {};
jest.mock('../../shared/services/coaching/fidelity/lp-fidelity-store', () => ({
  resolveMoveList: jest.fn(async (key) => {
    const moves = mockMoveLists[`${key.lesson_id}:${key.content_hash}`];
    return moves ? { lesson_id: key.lesson_id, content_hash: key.content_hash, moves, resolved: 'exact' } : null;
  }),
}));

const mockTables = {};
const mockReadErrors = {};
const mockQueries = [];
function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const q = { table, filters: [] };
  mockQueries.push(q);
  const result = () => (mockReadErrors[table]
    ? { data: null, error: { message: mockReadErrors[table] } }
    : { data: rows, error: null });
  const b = {
    select: (cols) => { q.select = cols; return b; },
    eq: (col, val) => { q.filters.push(['eq', col, val]); rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    gte: (col, val) => { rows = rows.filter((r) => String(r[col]) >= String(val)); return b; },
    lte: (col, val) => { rows = rows.filter((r) => String(r[col]) <= String(val)); return b; },
    lt: (col, val) => { rows = rows.filter((r) => String(r[col]) < String(val)); return b; },
    in: (col, vals) => { rows = rows.filter((r) => vals.map(String).includes(String(r[col]))); return b; },
    order: (col, opts) => {
      const asc = !!(opts && opts.ascending);
      rows = [...rows].sort((a, c) => (asc ? 1 : -1) * String(a[col]).localeCompare(String(c[col])));
      return b;
    },
    limit: (n) => { q.limit = n; rows = rows.slice(0, n); return b; },
    maybeSingle: () => {
      const r = result();
      return Promise.resolve(r.error ? r : { data: (r.data || [])[0] || null, error: null });
    },
    then: (f, r) => Promise.resolve(result()).then(f, r),
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));

jest.mock('../../shared/services/lp-v8-catalog.service', () => ({
  lessonById: jest.fn((lessonId) => {
    const m = /^grade_(\d)_(\w+?)_ch(\d+)_seg(\d+)/.exec(lessonId);
    if (!m) return null;
    return {
      lesson: { lesson_id: lessonId, segment_index: Number(m[4]), topic: `Topic of ${lessonId}`, topic_short: `Topic ${m[4]}`, pages_label: 'p. 12' },
      chapter: { number: Number(m[3]), title: `Chapter ${m[3]} title` },
      book: { grade: Number(m[1]), subject: m[2] === 'maths' ? 'Mathematics' : m[2], subject_key: m[2] },
    };
  }),
}));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const repo = require('../../shared/calls/call-tools.repo');
const { createCallTools } = require('../../shared/calls/call-tools.service');

const USER = 'user-1';
const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400 * 1000).toISOString();

const LESSON = 'grade_2_maths_ch1_seg2';
const OTHER = 'grade_3_english_ch1_seg1';

function asset(lessonId, hash, createdAt, extra = {}) {
  return {
    id: `asset-${lessonId}-${hash}`, lesson_id: lessonId, asset_kind: 'lesson',
    r2_key: `lp-cache/v8/${lessonId}/${hash}.pdf`, content_hash: hash,
    version_stamp: `v-${hash}`, is_current: true, superseded_at: null, created_at: createdAt, ...extra,
  };
}
function open(lessonId, openedAt, extra = {}) {
  return {
    id: `open-${lessonId}-${openedAt}`, user_id: USER, plan_kind: 'k5', plan_ref: lessonId,
    source: 'viewer', opened_at: openedAt, ...extra,
  };
}
function download(lessonId, hash, createdAt) {
  return {
    user_id: USER, lesson_id: lessonId, status: 'sent', content_hash: hash, version_stamp: `v-${hash}`,
    grade: 3, subject: 'english', chapter_number: 1, created_at: createdAt,
  };
}
const MOVES = [{ phase: 'hook', text: 'Count the beads aloud', bucket: 'must_happen' }];

const tools = () => createCallTools({ callerUserId: USER, callerNumber: '920000000000', repo, onTrace: jest.fn() });

const QUIZ_SWITCH = 'LP_QUIZ_COUNT_APP_OPENS';
const ENV_KEYS = ['LP_CONTEXT_COUNT_APP_OPENS', QUIZ_SWITCH];
const savedEnv = {};
beforeAll(() => { ENV_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; }); });
afterAll(() => { ENV_KEYS.forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }); });

beforeEach(() => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  mockMoveLists = {};
  mockQueries.length = 0;
  Object.keys(mockReadErrors).forEach((k) => delete mockReadErrors[k]);
  mockTables.niete_lp_downloads = [];
  mockTables.niete_lp_assets = [];
  mockTables.niete_lp_opens = [];
  mockTables.app_settings = [];
  mockTables.users = [];
  jest.clearAllMocks();
});

describe('a lesson read only in the app', () => {
  test('lookup_lesson finds it, with the steps and script of the version the app served her', async () => {
    // Served at the open: h1. A newer render (h2) came after she read it.
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20)), asset(LESSON, 'h2', minsAgo(1))];
    mockTables.niete_lp_assets[0].is_current = false;
    mockTables.niete_lp_assets[0].superseded_at = minsAgo(1);
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(30))];
    mockMoveLists[`${LESSON}:h1`] = MOVES;

    const out = await tools().invoke('lookup_lesson', {});

    expect(out).toContain('Grade 2 maths — Ch 1 "Chapter 1 title"');
    expect(out).toContain('opened in the app');
    expect(out).toContain(`SCRIPT FOR lp-cache/v8/${LESSON}/h1.pdf`);
    expect(out).toContain('Count the beads aloud');
  });

  test('findLessons returns it with the served asset, marked as an app lesson', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(30))];
    const rows = await repo.findLessons({ userId: USER });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      lesson_id: LESSON, content_hash: 'h1', version_stamp: 'v-h1', asset_id: `asset-${LESSON}-h1`, via: 'app',
    });
    expect(rows[0].created_at).toBe(mockTables.niete_lp_opens[0].opened_at);
  });

  test('the script is read by the served asset id when one is given', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    const detail = await repo.readLessonScript({ userId: USER, lessonId: LESSON, contentHash: 'h1', assetId: `asset-${LESSON}-h1` });
    expect(detail.script).toBe(`SCRIPT FOR lp-cache/v8/${LESSON}/h1.pdf`);
    const assetRead = mockQueries.find((q) => q.table === 'niete_lp_assets');
    expect(assetRead.filters).toContainEqual(['eq', 'id', `asset-${LESSON}-h1`]);
  });

  test('an external open is not a lesson she read', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(30), { source: 'external' })];
    expect(await repo.findLessons({ userId: USER })).toEqual([]);
  });
});

describe('both surfaces', () => {
  test('a newer app lesson is listed above an older WhatsApp lesson', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20)), asset(OTHER, 'e1', daysAgo(20))];
    mockTables.niete_lp_downloads = [download(OTHER, 'e1', daysAgo(2))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(30))];
    const rows = await repo.findLessons({ userId: USER });
    expect(rows.map((r) => r.lesson_id)).toEqual([LESSON, OTHER]);
    expect(rows[1].via).toBeUndefined();
  });

  test('one row per lesson: the WhatsApp version, at the newer app-open time', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h2', daysAgo(1))];
    mockTables.niete_lp_downloads = [{ ...download(LESSON, 'h1', daysAgo(3)), grade: 2, subject: 'maths' }];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(30))];
    const rows = await repo.findLessons({ userId: USER });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lesson_id: LESSON, content_hash: 'h1' });
    expect(rows[0].created_at).toBe(mockTables.niete_lp_opens[0].opened_at);
  });
});

describe('the switch and failure', () => {
  test('LP_CONTEXT_COUNT_APP_OPENS=off → WhatsApp lessons only, byte-identical, and no opens read', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20)), asset(OTHER, 'e1', daysAgo(20))];
    mockTables.niete_lp_downloads = [download(OTHER, 'e1', daysAgo(2))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(30))];
    process.env.LP_CONTEXT_COUNT_APP_OPENS = 'off';
    const off = await repo.findLessons({ userId: USER });
    expect(mockQueries.some((q) => q.table === 'niete_lp_opens')).toBe(false);
    mockTables.niete_lp_opens = [];
    delete process.env.LP_CONTEXT_COUNT_APP_OPENS;
    const whatsappOnly = await repo.findLessons({ userId: USER });
    expect(off).toEqual(whatsappOnly);
    expect(off.map((r) => r.lesson_id)).toEqual([OTHER]);
  });

  test('the quiz offer\'s own switch does not turn the call lookup off', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(30))];
    process.env[QUIZ_SWITCH] = 'off';
    expect((await repo.findLessons({ userId: USER })).map((r) => r.lesson_id)).toEqual([LESSON]);
  });

  test('a failed opens read costs only the app lessons, never the WhatsApp ones', async () => {
    mockTables.niete_lp_assets = [asset(OTHER, 'e1', daysAgo(20))];
    mockTables.niete_lp_downloads = [download(OTHER, 'e1', daysAgo(2))];
    mockReadErrors.niete_lp_opens = 'boom';
    expect((await repo.findLessons({ userId: USER })).map((r) => r.lesson_id)).toEqual([OTHER]);
  });
});
