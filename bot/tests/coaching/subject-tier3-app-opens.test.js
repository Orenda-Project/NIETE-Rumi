/**
 * Coaching subject resolution, tier 3: a lesson plan read in the teacher app counts as a recent plan.
 *
 * Since K-5 plans are read in the app's viewer (niete_lp_opens, plan_kind 'k5', source 'viewer'),
 * a teacher with no class pick, no uploaded plan and no linked plan often has NO WhatsApp download
 * in the 6 h window — tier 3 found nothing and the subject fell to "not confirmed". Her viewer
 * opens now join her downloads, one entry per lesson, behind LP_CONTEXT_COUNT_APP_OPENS.
 *
 * What is real here: analysis-processor.resolveSessionSubject, subject-resolution, the app-open
 * store, the K-5 catalogue and the A/B service. Mocked: the database client only.
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

// The LLM client is built at require time; no call is made in this file.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
const AnalysisProcessorService = require('../../shared/services/coaching/analysis-processor.service');

const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400 * 1000).toISOString();

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
function download(lessonId, subject, grade, createdAt) {
  return { user_id: 'user-1', lesson_id: lessonId, status: 'sent', subject, grade, created_at: createdAt };
}
// A self-recording with nothing on the row: no class pick, no uploaded plan, no linked plan.
const SESSION = { id: 'session-1', user_id: 'user-1', conversation_state: {}, lesson_plan_structured: null };

const ENV_KEYS = ['LP_CONTEXT_COUNT_APP_OPENS', 'LP_QUIZ_COUNT_APP_OPENS'];
const savedEnv = {};
beforeAll(() => { ENV_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; }); });
afterAll(() => { ENV_KEYS.forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }); });

beforeEach(() => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  mockQueries.length = 0;
  Object.keys(mockReadErrors).forEach((k) => delete mockReadErrors[k]);
  mockTables.niete_lp_downloads = [];
  mockTables.niete_lp_assets = [asset(URDU, 'u1', daysAgo(20)), asset(ENGLISH, 'e1', daysAgo(20))];
  mockTables.niete_lp_opens = [];
  mockTables.app_settings = [];
  mockTables.users = [];
});

describe('tier 3 — the only recent plan is an app open', () => {
  test('resolves that lesson\'s subject and grade as a recent plan', async () => {
    mockTables.niete_lp_opens = [open(URDU, minsAgo(90))];

    const r = await AnalysisProcessorService.resolveSessionSubject(SESSION);

    expect(r).toMatchObject({ code: 'urdu', grade: '2', confidence: 'medium', source: 'recent_download', group: 'literacy' });
  });

  test('an app open outside the 6 h window is not a signal', async () => {
    mockTables.niete_lp_opens = [open(URDU, minsAgo(7 * 60))];
    const r = await AnalysisProcessorService.resolveSessionSubject(SESSION);
    expect(r).toMatchObject({ code: null, confidence: 'none', source: 'no_signal' });
  });

  test('an external (non-viewer) open is not a signal', async () => {
    mockTables.niete_lp_opens = [open(URDU, minsAgo(30), { source: 'external' })];
    const r = await AnalysisProcessorService.resolveSessionSubject(SESSION);
    expect(r).toMatchObject({ confidence: 'none', source: 'no_signal' });
  });

  test('an app open of a different subject next to a download is ambiguous, as two downloads are', async () => {
    mockTables.niete_lp_downloads = [download(ENGLISH, 'english', '2', minsAgo(60))];
    mockTables.niete_lp_opens = [open(URDU, minsAgo(30))];
    const r = await AnalysisProcessorService.resolveSessionSubject(SESSION);
    expect(r).toMatchObject({ code: null, confidence: 'none', source: 'ambiguous_downloads' });
  });

  test('the same lesson downloaded and opened is one entry, at the WhatsApp row\'s fields', async () => {
    mockTables.niete_lp_downloads = [download(URDU, 'urdu', '2', minsAgo(200))];
    mockTables.niete_lp_opens = [open(URDU, minsAgo(30))];
    const r = await AnalysisProcessorService.resolveSessionSubject(SESSION);
    expect(r).toMatchObject({ code: 'urdu', grade: '2', confidence: 'medium', source: 'recent_download' });
  });

  test('the opens read is per teacher, k5 viewer, inside the window and capped', async () => {
    mockTables.niete_lp_opens = [open(URDU, minsAgo(90))];
    await AnalysisProcessorService.resolveSessionSubject(SESSION);
    const q = mockQueries.find((x) => x.table === 'niete_lp_opens');
    expect(q).toBeDefined();
    expect(q.filters).toEqual(expect.arrayContaining([
      ['eq', 'user_id', 'user-1'], ['eq', 'plan_kind', 'k5'], ['eq', 'source', 'viewer'],
    ]));
    expect(q.filters.find((f) => f[0] === 'gte' && f[1] === 'opened_at')).toBeDefined();
    expect(q.limit).toBeLessThanOrEqual(50);
  });

  test('a failed opens read leaves the WhatsApp-only answer (non-blocking)', async () => {
    mockTables.niete_lp_downloads = [download(ENGLISH, 'english', '2', minsAgo(60))];
    mockTables.niete_lp_opens = [open(URDU, minsAgo(30))];
    mockReadErrors.niete_lp_opens = 'boom';
    const r = await AnalysisProcessorService.resolveSessionSubject(SESSION);
    expect(r).toMatchObject({ code: 'english', grade: '2', source: 'recent_download' });
  });
});

describe('LP_CONTEXT_COUNT_APP_OPENS off', () => {
  test.each(['false', 'off', '0'])('%s → byte-identical to WhatsApp-only, and no opens read', async (v) => {
    const run = async (env) => {
      ENV_KEYS.forEach((k) => delete process.env[k]);
      Object.assign(process.env, env);
      mockQueries.length = 0;
      return JSON.stringify(await AnalysisProcessorService.resolveSessionSubject(SESSION));
    };
    // Only an app open: off = exactly what WhatsApp-only gives (no signal).
    mockTables.niete_lp_opens = [open(URDU, minsAgo(30))];
    const offOnlyOpen = await run({ LP_CONTEXT_COUNT_APP_OPENS: v });
    mockTables.niete_lp_opens = [];
    const noOpens = await run({ LP_CONTEXT_COUNT_APP_OPENS: v });
    expect(offOnlyOpen).toBe(noOpens);
    expect(JSON.parse(offOnlyOpen)).toMatchObject({ source: 'no_signal' });

    // With a download: off ignores a conflicting open entirely, and the download query is unchanged.
    mockTables.niete_lp_downloads = [download(ENGLISH, 'english', '2', minsAgo(60))];
    mockTables.niete_lp_opens = [open(URDU, minsAgo(30))];
    const off = await run({ LP_CONTEXT_COUNT_APP_OPENS: v });
    expect(JSON.parse(off)).toMatchObject({ code: 'english', source: 'recent_download' });
    expect(mockQueries.some((q) => q.table === 'niete_lp_opens')).toBe(false);
    const dq = mockQueries.find((q) => q.table === 'niete_lp_downloads');
    expect(dq.select).toBe('subject, grade, created_at');
    expect(dq.limit).toBe(50);
  });
});
