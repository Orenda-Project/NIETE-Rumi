/**
 * POST /assessment/create with a G9-12 FBISE board pattern (bd-5jmnfj.38.25.2): its own flag
 * (`assessment_board_pattern_enabled`), its own eligibility (one grade, its own subjects), chapters
 * or pages only (a board pattern has no FDE syllabus), fixed marks, one paper per class at a time,
 * and a request typed from the board slots. Harness copied from fde-create.test.js.
 */

const KEY = 'fde-create-key';
const NOW_ISO = '2026-10-15T10:00:00.000Z';
let router;
let settings;
let recent;          // rows the generating-guard select returns (or an Error)
let reads;           // every filter the guard applied
let inserts;
let queued;

/** The maths book's contents page (only what chapterPages reads). */
const CHAPTERS = [
  { chapter_number: 1, page_start: 1, page_end: 12 },
  { chapter_number: 2, page_start: 14, page_end: 40 },
  { chapter_number: 3, page_start: 42, page_end: 66 },
  { chapter_number: 4, page_start: 68, page_end: 90 },
];

function findRoute(r, method, p) {
  for (const layer of r.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === p) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(p, body) {
  const stack = findRoute(router, 'post', p);
  const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path: p };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

function query(table) {
  const filters = {};
  const read = { table, eq: {}, gte: null, select: null, order: null, limit: null };
  let row = null;
  const b = {};
  b.select = (cols) => { read.select = cols; return b; };
  b.insert = (r) => { row = r; inserts.push({ table, row: r }); return b; };
  b.eq = (col, val) => { filters[col] = val; read.eq[col] = val; return b; };
  b.gte = (col, val) => { read.gte = [col, val]; return b; };
  b.order = (col, opts) => { read.order = [col, opts]; return b; };
  b.limit = (n) => { read.limit = n; return b; };
  b.maybeSingle = async () => {
    if (table !== 'app_settings') return { data: null, error: null };
    const v = settings[filters.key];
    if (v instanceof Error) throw v;
    return { data: v === undefined ? null : { key: filters.key, value: v }, error: null };
  };
  b.single = async () => (row ? { data: { id: 'req-new' }, error: null } : { data: null, error: null });
  b.then = (ok, ko) => {
    reads.push(read);
    const out = recent instanceof Error
      ? { data: null, error: { message: recent.message } }
      : { data: recent, error: null };
    return Promise.resolve(out).then(ok, ko);
  };
  return b;
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers({ now: new Date(NOW_ISO), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  process.env.INTERNAL_API_KEY = KEY;
  settings = { assessment_fde_pattern_enabled: true };
  recent = [];
  reads = [];
  inserts = [];
  queued = [];
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => query(t)) }));
  jest.doMock('../../../bot/shared/services/queue', () => ({
    queueJob: jest.fn(async (...args) => { queued.push(args); return { messageId: 'm-1' }; }),
  }));
  jest.doMock('../../../bot/shared/services/assessment/assessment-browse.service', () => ({
    bookFor: jest.fn(async () => ({ id: 'book-g5-maths', total_pages: 280 })),
    listChapters: jest.fn(async () => CHAPTERS),
  }));
  router = require('../../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

const BOARD = { userId: 'u-fictional-teacher-1', grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027' };
const row = () => inserts.find((i) => i.table === 'assessment_requests').row;
const job = () => queued[0][2];
const on = () => { settings.assessment_board_pattern_enabled = true; settings.assessment_grades_6_12 = true; };

describe('POST /assessment/create — a G9-12 board paper', () => {
  test('flag on + chapters → 202; the row is typed from the board slots and fixes nothing from the form', async () => {
    on();
    const { statusCode, payload } = await invoke('/assessment/create', { ...BOARD, chapterNumbers: [2, 1] });
    expect(statusCode).toBe(202);
    expect(payload).toEqual({ success: true, requestId: 'req-new' });
    const r = row();
    expect(r.page_ranges).toBe('1-12, 14-40');
    expect(r.question_count).toBe(68);
    expect(r.has_answer_key).toBe(true);
    expect(r.question_types[0]).toEqual({ id: 'mcq', count: 40, category: 'objective', slot: 'A.Q1-40' });
    expect(r.question_types.every((t) => t.count > 0)).toBe(true);
    expect(r.question_types.reduce((s, t) => s + t.count, 0)).toBe(68);
    const j = job();
    expect(j.pattern).toBe('fbise_ssc1_2027');
    expect(j.totalMarks).toBeNull();
    expect(j.scope).toEqual({ kind: 'chapters', chapters: [1, 2], pages: '1-12, 14-40' });
  });

  test('pages → scope kind pages', async () => {
    on();
    expect((await invoke('/assessment/create', { ...BOARD, pageRanges: '42-91' })).statusCode).toBe(202);
    expect(job().scope).toEqual({ kind: 'pages', chapters: null, pages: '42-91' });
  });

  test('board flag off → PATTERN_OFF, even with the FDE flag on; a failed read is off', async () => {
    settings.assessment_grades_6_12 = true;
    const { statusCode, payload } = await invoke('/assessment/create', { ...BOARD, chapterNumbers: [1] });
    expect(statusCode).toBe(400);
    expect(payload.errorCode).toBe('PATTERN_OFF');
    settings.assessment_board_pattern_enabled = new Error('db down');
    expect((await invoke('/assessment/create', { ...BOARD, chapterNumbers: [1] })).payload.errorCode).toBe('PATTERN_OFF');
    expect(inserts).toEqual([]);
  });

  test('the board flag does not open FDE patterns, and the FDE subject list does not limit board ones', async () => {
    on();
    settings.assessment_fde_pattern_enabled = false;
    const fde = await invoke('/assessment/create', { userId: 'u-fictional-teacher-1', grade: 5, subject: 'maths', pattern: 'fde_g5_2027', chapterNumbers: [1] });
    expect(fde.payload.errorCode).toBe('PATTERN_OFF');
    settings.assessment_fde_pattern_subjects = ['maths'];
    expect((await invoke('/assessment/create', { ...BOARD, chapterNumbers: [1] })).statusCode).toBe(202);
  });

  test('wrong grade or a subject the pattern does not set → PATTERN_INELIGIBLE', async () => {
    on();
    for (const extra of [{ grade: 10 }, { subject: 'computer_science' }]) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await invoke('/assessment/create', { ...BOARD, ...extra, chapterNumbers: [1] });
      expect(statusCode).toBe(400);
      expect(payload.errorCode).toBe('PATTERN_INELIGIBLE');
    }
    expect(inserts).toEqual([]);
  });

  test('scope fde → SCOPE_CONFLICT (a board paper has no FDE syllabus); no scope → chapters error', async () => {
    on();
    const fde = await invoke('/assessment/create', { ...BOARD, scope: 'fde' });
    expect(fde.statusCode).toBe(400);
    expect(fde.payload).toEqual({ success: false, error: 'A board paper takes chapters or pages.', errorCode: 'SCOPE_CONFLICT' });
    const none = await invoke('/assessment/create', { ...BOARD });
    expect(none.payload.error).toBe('chapterNumbers or pageRanges is required');
    expect(inserts).toEqual([]);
  });

  test('a marks budget → PATTERN_NO_BUDGET', async () => {
    on();
    const { payload } = await invoke('/assessment/create', { ...BOARD, chapterNumbers: [1], totalMarks: 60 });
    expect(payload.errorCode).toBe('PATTERN_NO_BUDGET');
  });

  test('a paper already being made for this class → 409 with its id', async () => {
    on();
    recent = [{ id: 'req-old', created_at: NOW_ISO, question_types: [{ id: 'mcq', count: 40, slot: 'A.Q1-40' }], assessment_papers: [{ status: 'generating', edited_from: null }] }];
    const { statusCode, payload } = await invoke('/assessment/create', { ...BOARD, chapterNumbers: [1] });
    expect(statusCode).toBe(409);
    expect(payload.errorCode).toBe('ALREADY_GENERATING');
    expect(payload.requestId).toBe('req-old');
  });

  test('the 6-12 grade gate still runs first: shut → refused before any pattern check', async () => {
    settings.assessment_board_pattern_enabled = true;
    const { statusCode, payload } = await invoke('/assessment/create', { ...BOARD, chapterNumbers: [1] });
    expect(statusCode).toBe(400);
    expect(payload.errorCode).not.toBe('PATTERN_OFF');
    expect(inserts).toEqual([]);
  });
});
