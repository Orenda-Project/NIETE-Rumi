/**
 * Chat grounding sees the lesson plans a teacher read in the teacher app.
 *
 * Since the app became the place a lesson plan is read, most K-5 plans are opened in the app's
 * viewer (niete_lp_opens, plan_kind 'k5', source 'viewer') and never delivered on WhatsApp. The
 * chat's lesson context read only the WhatsApp shelf and niete_lp_downloads, so a teacher asking
 * about the plan in her hand was answered with no plan at all.
 *
 * What is real here: lp-context.service, the app-open store (lp-app-opens.store), the switch
 * module and the A/B service. Mocked: the database client, Redis (the shelf), R2 (the voicenote
 * script), the move-list store and the catalogue.
 */

/* eslint-disable global-require */

let mockShelf = [];
jest.mock('../../shared/services/lp-shelf.service', () => ({
  getShelf: jest.fn(async () => mockShelf),
  pushToShelf: jest.fn(async () => {}),
  flushShelf: jest.fn(async () => {}),
}));

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

const { buildLpContext, deliveryHint } = require('../../shared/services/lp-context.service');

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
    id: `open-${lessonId}-${openedAt}`, user_id: 'user-1', plan_kind: 'k5', plan_ref: lessonId,
    source: 'viewer', opened_at: openedAt, ...extra,
  };
}
function download(lessonId, hash, createdAt) {
  return {
    user_id: 'user-1', lesson_id: lessonId, status: 'sent', content_hash: hash, version_stamp: `v-${hash}`,
    grade: 2, subject: 'maths', chapter_number: 1, segment_index: 2, created_at: createdAt,
  };
}
const MOVES = [{ phase: 'hook', text: 'Count the beads aloud', bucket: 'must_happen' }];

const ENV_KEYS = ['LP_CONTEXT_COUNT_APP_OPENS', 'LP_QUIZ_COUNT_APP_OPENS'];
const savedEnv = {};
beforeAll(() => { ENV_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; }); });
afterAll(() => { ENV_KEYS.forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }); });

beforeEach(() => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  mockShelf = [];
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
  test('is in the chat context, at the version the app served her, with its steps and script', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(20))];
    mockMoveLists[`${LESSON}:h1`] = MOVES;

    const ctx = await buildLpContext('user-1');

    expect(ctx).not.toBeNull();
    expect(ctx.lessonIds).toEqual([LESSON]);
    expect(ctx.entries[0]).toMatchObject({ lesson_id: LESSON, content_hash: 'h1', version_stamp: 'v-h1' });
    expect(ctx.entries[0].delivered_at).toBe(mockTables.niete_lp_opens[0].opened_at);
    expect(ctx.fullBlock).toContain('Count the beads aloud');
    expect(ctx.fullBlock).toContain(`SCRIPT FOR lp-cache/v8/${LESSON}/h1.pdf`);
    expect(ctx.fullBlock).toContain('(opened in the teacher app)');
    expect(ctx.identityLine).toContain('Grade 2');
  });

  test('the per-teacher read is narrow and capped', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(20))];
    await buildLpContext('user-1');
    const opensReads = mockQueries.filter((q) => q.table === 'niete_lp_opens');
    expect(opensReads).toHaveLength(1);
    expect(opensReads[0].limit).toBe(6);
    expect(opensReads[0].filters).toEqual(expect.arrayContaining([
      ['eq', 'user_id', 'user-1'], ['eq', 'plan_kind', 'k5'], ['eq', 'source', 'viewer'],
    ]));
  });

  test('an external open (a link minted for another app) is not a lesson she read', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(20), { source: 'external' })];
    expect(await buildLpContext('user-1')).toBeNull();
  });

  test('an open older than 7 days is not recent', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, daysAgo(8))];
    expect(await buildLpContext('user-1')).toBeNull();
  });

  test('the classifier hint says she opened it in the app, not that a PDF was sent', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(5))];
    const ctx = await buildLpContext('user-1');
    const hint = deliveryHint(ctx.entries);
    expect(hint).toContain('opened a lesson plan in the teacher app');
    expect(hint).not.toContain('PDF was sent');
  });
});

describe('both surfaces', () => {
  test('one entry per lesson: the newest surface time, the WhatsApp row\'s version', async () => {
    mockTables.niete_lp_downloads = [download(LESSON, 'h1', minsAgo(180))];
    // A newer push since: the app would serve h2 now, but WhatsApp recorded what she was given.
    mockTables.niete_lp_assets = [
      asset(LESSON, 'h1', daysAgo(20), { is_current: false, superseded_at: minsAgo(60) }),
      asset(LESSON, 'h2', minsAgo(60)),
    ];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(10))];

    const ctx = await buildLpContext('user-1');

    expect(ctx.entries).toHaveLength(1);
    expect(ctx.entries[0]).toMatchObject({ lesson_id: LESSON, content_hash: 'h1', version_stamp: 'v-h1' });
    expect(ctx.entries[0].delivered_at).toBe(mockTables.niete_lp_opens[0].opened_at);
  });

  test('a newer app lesson sits above an older WhatsApp lesson; caps unchanged (2 entries)', async () => {
    mockTables.niete_lp_downloads = [download(LESSON, 'h1', daysAgo(2))];
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20)), asset(OTHER, 'o1', daysAgo(20)),
      asset('grade_1_urdu_ch2_seg1', 'u1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(OTHER, minsAgo(15)), open('grade_1_urdu_ch2_seg1', daysAgo(3))];

    const ctx = await buildLpContext('user-1');
    expect(ctx.lessonIds).toEqual([OTHER, LESSON]);
  });

  test('the WhatsApp shelf is not a wall: a newer app lesson joins it, newest first', async () => {
    mockShelf = [{
      lesson_id: LESSON, grade: 2, subject: 'maths', subject_label: 'Mathematics', chapter_number: 1,
      chapter_title: 'Chapter 1 title', r2_key: `lp-cache/v8/${LESSON}/h1.pdf`, content_hash: 'h1',
      delivered_at: minsAgo(240),
    }];
    mockTables.niete_lp_assets = [asset(OTHER, 'o1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(OTHER, minsAgo(5))];

    const ctx = await buildLpContext('user-1');
    expect(ctx.source).toBe('shelf');
    expect(ctx.lessonIds).toEqual([OTHER, LESSON]);
  });

  test('a shelf lesson she then opened in the app keeps the shelf version and takes the open time', async () => {
    const shelved = {
      lesson_id: LESSON, grade: 2, subject: 'maths', subject_label: 'Mathematics', chapter_number: 1,
      chapter_title: 'Chapter 1 title', r2_key: `lp-cache/v8/${LESSON}/h1.pdf`, content_hash: 'h1',
      delivered_at: minsAgo(240),
    };
    mockShelf = [shelved];
    mockTables.niete_lp_assets = [asset(LESSON, 'h2', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(5))];

    const ctx = await buildLpContext('user-1');
    expect(ctx.entries).toHaveLength(1);
    expect(ctx.entries[0].content_hash).toBe('h1');
    expect(ctx.entries[0].delivered_at).toBe(mockTables.niete_lp_opens[0].opened_at);
    expect(mockShelf[0].delivered_at).toBe(shelved.delivered_at);   // the shelf itself is not mutated
  });
});

describe('the switch and failure', () => {
  async function runWith(env) {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    Object.assign(process.env, env);
    return buildLpContext('user-1');
  }

  test('LP_CONTEXT_COUNT_APP_OPENS=false → byte-identical to WhatsApp-only, and no opens read', async () => {
    mockTables.niete_lp_downloads = [download(LESSON, 'h1', minsAgo(180))];
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20)), asset(OTHER, 'o1', daysAgo(20))];
    mockMoveLists[`${LESSON}:h1`] = MOVES;
    const opens = [open(OTHER, minsAgo(5)), open(LESSON, minsAgo(2))];

    mockTables.niete_lp_opens = [];
    const whatsappOnly = await runWith({ LP_CONTEXT_COUNT_APP_OPENS: 'false' });
    mockTables.niete_lp_opens = opens;
    mockQueries.length = 0;
    const off = await runWith({ LP_CONTEXT_COUNT_APP_OPENS: 'false' });

    expect(off.identityLine).toBe(whatsappOnly.identityLine);
    expect(off.fullBlock).toBe(whatsappOnly.fullBlock);
    expect(off.entries).toEqual(whatsappOnly.entries);
    expect(mockQueries.some((q) => q.table === 'niete_lp_opens')).toBe(false);

    const on = await runWith({});
    expect(on.lessonIds).toEqual([LESSON, OTHER]);
  });

  test('switch off and only an app open → null, as today', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(20))];
    expect(await runWith({ LP_CONTEXT_COUNT_APP_OPENS: 'off' })).toBeNull();
  });

  test('the quiz offer\'s own switch does not turn chat grounding off', async () => {
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockTables.niete_lp_opens = [open(LESSON, minsAgo(20))];
    const ctx = await runWith({ LP_QUIZ_COUNT_APP_OPENS: 'false' });
    expect(ctx && ctx.lessonIds).toEqual([LESSON]);
  });

  test('a failed opens read costs only the app lessons, never the WhatsApp ones', async () => {
    mockTables.niete_lp_downloads = [download(LESSON, 'h1', minsAgo(180))];
    mockTables.niete_lp_assets = [asset(LESSON, 'h1', daysAgo(20))];
    mockReadErrors.niete_lp_opens = 'connection reset';
    const ctx = await buildLpContext('user-1');
    expect(ctx.lessonIds).toEqual([LESSON]);
  });
});
