/**
 * The post-coaching transcript quiz's lesson-plan HINT sees a plan read in the teacher app.
 *
 * lpHintFor looks for the plan the teacher had in the 36 h before (and 6 h after) the recording,
 * matching the lesson's subject. Since K-5 plans are read in the app's viewer (niete_lp_opens,
 * plan_kind 'k5', source 'viewer') and not delivered on WhatsApp, those sessions got no hint.
 * Her viewer opens now join her downloads, one entry per lesson, behind LP_CONTEXT_COUNT_APP_OPENS.
 *
 * What is real here: transcript-quiz-digest.lpHintFor, the app-open store, the K-5 catalogue and
 * the A/B service. Mocked: the database client only.
 */

/* eslint-disable global-require */

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
    gte: (col, val) => { q.filters.push(['gte', col, val]); rows = rows.filter((r) => String(r[col]) >= String(val)); return b; },
    lte: (col, val) => { q.filters.push(['lte', col, val]); rows = rows.filter((r) => String(r[col]) <= String(val)); return b; },
    lt: (col, val) => { q.filters.push(['lt', col, val]); rows = rows.filter((r) => String(r[col]) < String(val)); return b; },
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
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { lpHintFor } = require('../../shared/services/quiz/transcript-quiz-digest.service');

const AT = new Date('2026-10-13T08:00:00.000Z');          // the recording
const hoursFrom = (h) => new Date(AT.getTime() + h * 3600 * 1000).toISOString();

const URDU = 'grade_2_urdu_ch3_seg2';
const ENGLISH = 'grade_2_english_ch1_seg1';

function asset(lessonId, hash, createdAt) {
  return {
    id: `asset-${lessonId}-${hash}`, lesson_id: lessonId, asset_kind: 'lesson', content_hash: hash,
    version_stamp: `v-${hash}`, is_current: true, superseded_at: null, created_at: createdAt,
  };
}
function open(lessonId, openedAt, extra = {}) {
  return {
    id: `open-${lessonId}-${openedAt}`, user_id: 'user-1', plan_kind: 'k5', plan_ref: lessonId,
    source: 'viewer', opened_at: openedAt, ...extra,
  };
}
function download(lessonId, createdAt, extra = {}) {
  const m = /^grade_(\d)_(\w+?)_ch(\d+)_seg(\d+)/.exec(lessonId);
  return {
    user_id: 'user-1', lesson_id: lessonId, status: 'sent', grade: m[1], subject: m[2],
    chapter_number: Number(m[3]), segment_index: Number(m[4]), created_at: createdAt, ...extra,
  };
}
const hint = (subject) => lpHintFor({ userId: 'user-1', sessionCreatedAt: AT.toISOString(), subject });

const ENV_KEYS = ['LP_CONTEXT_COUNT_APP_OPENS', 'LP_QUIZ_COUNT_APP_OPENS'];
const GONE = 'LP_CONTEXT_COUNT_APP_OPENS'; // bd-2wgr3d.22.1: no longer read by any code
const savedEnv = {};
beforeAll(() => { ENV_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; }); });
afterAll(() => { ENV_KEYS.forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }); });

beforeEach(() => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  mockQueries.length = 0;
  Object.keys(mockReadErrors).forEach((k) => delete mockReadErrors[k]);
  mockTables.niete_lp_downloads = [];
  mockTables.niete_lp_assets = [asset(URDU, 'u1', '2026-09-01T00:00:00.000Z'), asset(ENGLISH, 'e1', '2026-09-01T00:00:00.000Z')];
  mockTables.niete_lp_opens = [];
  mockTables.lesson_plan_catalog = [
    { id: URDU, chapter_title: 'Urdu chapter three', grade: 2, subject: 'urdu' },
    { id: ENGLISH, chapter_title: 'English chapter one', grade: 2, subject: 'english' },
  ];
  mockTables.app_settings = [];
  mockTables.users = [];
});

describe('the only plan she had is an app open', () => {
  test('that lesson is the hint, shaped as a download hint', async () => {
    mockTables.niete_lp_opens = [open(URDU, hoursFrom(-20))];

    expect(await hint('Urdu')).toEqual({
      grade: '2', subject: 'urdu', chapter_title: 'Urdu chapter three',
      lesson_id: URDU, chapter_number: 3, segment_index: 2,
    });
  });

  test('an open after the +6 h edge or before the -36 h edge is not a hint', async () => {
    mockTables.niete_lp_opens = [open(URDU, hoursFrom(7)), open(URDU, hoursFrom(-37))];
    expect(await hint('Urdu')).toBeNull();
  });

  // bd-2wgr3d.22.1 — operator 14 Oct: a hand-off only ever starts inside the app; it is a plan taken.
  test('a plan handed from the app to another app (external) is a hint like a viewer open', async () => {
    mockTables.niete_lp_opens = [open(URDU, hoursFrom(-2), { source: 'external' })];
    expect(await hint('Urdu')).toMatchObject({ lesson_id: URDU });
  });

  test('the subject must match, as for a download', async () => {
    mockTables.niete_lp_opens = [open(ENGLISH, hoursFrom(-2))];
    expect(await hint('Urdu')).toBeNull();
  });

  test('newest first across both surfaces: a newer app open of the subject beats an older download', async () => {
    mockTables.niete_lp_downloads = [download(ENGLISH, hoursFrom(-30), { subject: 'urdu', lesson_id: 'grade_2_urdu_ch1_seg1', chapter_number: 1, segment_index: 1 })];
    mockTables.niete_lp_opens = [open(URDU, hoursFrom(-3))];
    expect((await hint('Urdu')).lesson_id).toBe(URDU);
  });

  test('a lesson both downloaded and opened is one entry, at the WhatsApp row', async () => {
    mockTables.niete_lp_downloads = [download(URDU, hoursFrom(-30), { grade: '2' })];
    mockTables.niete_lp_opens = [open(URDU, hoursFrom(-2))];
    expect(await hint('Urdu')).toMatchObject({ lesson_id: URDU, grade: '2', subject: 'urdu' });
  });

  test('the opens read is per teacher, k5 viewer, bounded on both sides and capped', async () => {
    mockTables.niete_lp_opens = [open(URDU, hoursFrom(-2))];
    await hint('Urdu');
    const q = mockQueries.find((x) => x.table === 'niete_lp_opens');
    expect(q).toBeDefined();
    expect(q.filters).toEqual(expect.arrayContaining([
      ['eq', 'user_id', 'user-1'], ['eq', 'plan_kind', 'k5'],
      ['gte', 'opened_at', hoursFrom(-36)], ['lte', 'opened_at', hoursFrom(6)],
    ]));
    expect(q.filters.some(([, col]) => col === 'source')).toBe(false);
    expect(q.limit).toBeLessThanOrEqual(10);
  });

  test('a failed opens read leaves the download hint', async () => {
    mockTables.niete_lp_downloads = [download(URDU, hoursFrom(-30))];
    mockReadErrors.niete_lp_opens = 'boom';
    expect(await hint('Urdu')).toMatchObject({ lesson_id: URDU });
  });
});

// bd-2wgr3d.22.1 — no switch on the fix: the app link is the only on/off.
describe('LP_CONTEXT_COUNT_APP_OPENS is gone', () => {
  test.each(['false', 'off', '0'])('%s changes nothing: an app open is still the hint', async (v) => {
    process.env[GONE] = v; // the removed switch, set to show it no longer matters
    mockTables.niete_lp_opens = [open(URDU, hoursFrom(-2))];
    expect(await hint('Urdu')).toMatchObject({ lesson_id: URDU });
  });
});
