/**
 * POST /assessment/create with a board pattern: the checks, in order, and the request it writes.
 *
 * A pattern paper fixes its own shape — the slot list, the question count, the marks — so the
 * server fills those in from the pattern and refuses anything that would contradict it. The
 * refusals come in a fixed order (flag, eligibility, scope conflict, missing scope, marks budget,
 * one-at-a-time), so a request with the flag off never learns whether it would have been eligible.
 *
 * Driven through the real route stack AND the real request service: the row and the queued job are
 * read off the mocked database and queue, so every assertion is on what would actually be written.
 * Without `pattern` the route must call createAndQueue with exactly today's object.
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
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => query(t)) }));
  jest.doMock('../../bot/shared/services/queue', () => ({
    queueJob: jest.fn(async (...args) => { queued.push(args); return { messageId: 'm-1' }; }),
  }));
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    bookFor: jest.fn(async () => ({ id: 'book-g5-maths', total_pages: 280 })),
    listChapters: jest.fn(async () => CHAPTERS),
  }));
  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

const PATTERN = { userId: 'teacher-1', grade: 5, subject: 'maths', pattern: 'fde_g5_2027' };
const MATHS_RANGES = '1-12, 14-40, 42-66, 68-90, 92-116, 118-144, 155-168, 171-180, 218-226, 239-244, 254-257, 267-271';
const row = () => inserts.find((i) => i.table === 'assessment_requests').row;
const job = () => queued[0][2];

describe('POST /assessment/create — a board-pattern paper', () => {
  test('pattern + scope fde → row page_ranges = the 12 ranges, question_types slot-tagged, questionCount 48, totalMarks null', async () => {
    const { statusCode, payload } = await invoke('/assessment/create', { ...PATTERN, scope: 'fde', answerLines: false });
    expect(statusCode).toBe(202);
    expect(payload).toEqual({ success: true, requestId: 'req-new' });

    const r = row();
    expect(r.page_ranges).toBe(MATHS_RANGES);
    expect(r.page_ranges.split(', ')).toHaveLength(12);
    expect(r.chapter_number).toBeNull();
    expect(r.question_count).toBe(48);
    expect(r.content_source).toBe('unseen');
    expect(r.has_answer_key).toBe(true);
    expect(r.has_answer_lines).toBe(false);
    expect(r.output_format).toBe('pdf');
    expect(r.textbook_id).toBe('book-g5-maths');
    expect(r.question_types.every((t) => typeof t.slot === 'string' && t.slot.startsWith('maths.'))).toBe(true);
    expect(r.question_types.reduce((s, t) => s + t.count, 0)).toBe(48);
    expect(r.question_types[0]).toEqual({ id: 'MCQs', count: 20, category: 'objective', slot: 'maths.A.Q1a' });

    const j = job();
    expect(j.totalMarks).toBeNull();
    expect(j.seenCount).toBeNull();
    expect(j.questionCount).toBe(48);
    expect(j.includeAnswerKey).toBe(true);
    expect(j.chapterNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11, 12]);
    expect(j.pattern).toBe('fde_g5_2027');
    expect(j.scope).toEqual({ kind: 'fde', chapters: [1, 2, 3, 4, 5, 6, 7, 8, 11, 12], pages: MATHS_RANGES });
  });

  test('pattern + chapters → chapter pages', async () => {
    const { statusCode } = await invoke('/assessment/create', { ...PATTERN, chapterNumbers: [3, 1, 2] });
    expect(statusCode).toBe(202);
    expect(row().page_ranges).toBe('1-12, 14-40, 42-66');
    expect(row().question_count).toBe(48);
    expect(job().scope).toEqual({ kind: 'chapters', chapters: [1, 2, 3], pages: '1-12, 14-40, 42-66' });

    inserts = []; queued = [];
    expect((await invoke('/assessment/create', { ...PATTERN, chapterNumbers: [99] })).statusCode).toBe(400);
    expect(inserts).toEqual([]);

    expect((await invoke('/assessment/create', { ...PATTERN, pageRanges: '42-91' })).statusCode).toBe(202);
    expect(job().scope).toEqual({ kind: 'pages', chapters: null, pages: '42-91' });
  });

  test('scope fde + chapters → 400 SCOPE_CONFLICT', async () => {
    for (const extra of [{ chapterNumbers: [3] }, { pageRanges: '42-91' }]) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await invoke('/assessment/create', { ...PATTERN, scope: 'fde', ...extra });
      expect(statusCode).toBe(400);
      expect(payload).toEqual({ success: false, error: 'Send either the FDE syllabus or chapters, not both.', errorCode: 'SCOPE_CONFLICT' });
    }
    expect(queued).toEqual([]);
  });

  test('a pattern with no scope and no chapters is today\'s chapters error', async () => {
    const { statusCode, payload } = await invoke('/assessment/create', { ...PATTERN });
    expect(statusCode).toBe(400);
    expect(payload).toEqual({ success: false, error: 'chapterNumbers or pageRanges is required' });
  });

  test('pattern + totalMarks → 400 PATTERN_NO_BUDGET', async () => {
    for (const totalMarks of [50, 0, '100']) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await invoke('/assessment/create', { ...PATTERN, scope: 'fde', totalMarks });
      expect(statusCode).toBe(400);
      expect(payload).toEqual({ success: false, error: 'Board-pattern papers fix their marks.', errorCode: 'PATTERN_NO_BUDGET' });
    }
    // Absent, null and '' are "no budget" — the form sends '' for an empty box.
    for (const totalMarks of [null, '']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await invoke('/assessment/create', { ...PATTERN, scope: 'fde', totalMarks })).statusCode).toBe(202);
    }
  });

  test('flag off → 400 PATTERN_OFF', async () => {
    settings.assessment_fde_pattern_enabled = false;
    // Even an ineligible grade answers PATTERN_OFF: a switched-off pattern reveals nothing.
    for (const body of [{ ...PATTERN, scope: 'fde' }, { ...PATTERN, grade: 4, scope: 'fde' }]) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode, payload } = await invoke('/assessment/create', body);
      expect(statusCode).toBe(400);
      expect(payload).toEqual({
        success: false,
        error: 'Board-pattern papers are off right now. Make your own paper or try later.',
        errorCode: 'PATTERN_OFF',
      });
    }
    settings.assessment_fde_pattern_enabled = new Error('connection reset');
    expect((await invoke('/assessment/create', { ...PATTERN, scope: 'fde' })).payload.errorCode).toBe('PATTERN_OFF');
    expect(queued).toEqual([]);
  });

  test('grade 4 → 400', async () => {
    const { statusCode, payload } = await invoke('/assessment/create', { ...PATTERN, grade: 4, scope: 'fde' });
    expect(statusCode).toBe(400);
    expect(payload.errorCode).toBe('PATTERN_INELIGIBLE');
    expect((await invoke('/assessment/create', { ...PATTERN, pattern: 'no_such_pattern', scope: 'fde' })).payload.errorCode)
      .toBe('PATTERN_INELIGIBLE');
  });

  test('islamiat + pattern → 400 PATTERN_INELIGIBLE', async () => {
    const { statusCode, payload } = await invoke('/assessment/create', { ...PATTERN, subject: 'islamiat', scope: 'fde' });
    expect(statusCode).toBe(400);
    expect(payload).toEqual({
      success: false, error: 'That board pattern is not available for this grade and subject.', errorCode: 'PATTERN_INELIGIBLE',
    });
    expect(queued).toEqual([]);
  });

  test('subjects list excludes urdu → create 400 PATTERN_INELIGIBLE', async () => {
    settings.assessment_fde_pattern_subjects = ['maths', 'science', 'english'];
    const urdu = await invoke('/assessment/create', { ...PATTERN, subject: 'urdu', scope: 'fde' });
    expect(urdu.statusCode).toBe(400);
    expect(urdu.payload.errorCode).toBe('PATTERN_INELIGIBLE');
    expect((await invoke('/assessment/create', { ...PATTERN, subject: 'maths', scope: 'fde' })).statusCode).toBe(202);
  });

  test('list absent → all five eligible', async () => {
    for (const subject of ['maths', 'science', 'english', 'urdu', 'social_studies']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await invoke('/assessment/create', { ...PATTERN, subject, scope: 'fde' })).statusCode).toBe(202);
    }
  });

  test('second request within 10 min → 409 ALREADY_GENERATING', async () => {
    // The first paper's request: slot-tagged, its paper still being written.
    recent = [{ id: 'req-first', created_at: '2026-10-15T09:55:00Z', question_types: [{ id: 'MCQs', count: 20, slot: 'maths.A.Q1a' }], assessment_papers: [{ status: 'generating', edited_from: null }] }];
    const { statusCode, payload } = await invoke('/assessment/create', { ...PATTERN, scope: 'fde' });
    expect(statusCode).toBe(409);
    expect(payload).toEqual({
      success: false, error: 'A paper for this class is being made.', errorCode: 'ALREADY_GENERATING', requestId: 'req-first',
    });
    expect(inserts).toEqual([]);
    expect(queued).toEqual([]);

    // One read, on this teacher's class, ten minutes back, newest first.
    const guard = reads.find((r) => r.table === 'assessment_requests');
    expect(guard.eq).toEqual({ user_id: 'teacher-1', grade_code: 'grade_5', subject_code: 'maths' });
    expect(guard.gte).toEqual(['created_at', '2026-10-15T09:50:00.000Z']);
    expect(guard.select).toMatch(/assessment_papers\(status, edited_from, updated_at\)/);
    expect(guard.order).toEqual(['created_at', { ascending: false }]);
    expect(guard.limit).toBe(5);

    // A paper row that is still generating blocks the same way.
    recent = [{ id: 'req-gen', question_types: [{ slot: 'maths.A.Q1a' }], assessment_papers: [{ status: 'generating', edited_from: null }] }];
    expect((await invoke('/assessment/create', { ...PATTERN, scope: 'fde' })).payload.requestId).toBe('req-gen');
  });

  test('a ready or failed earlier paper does not block', async () => {
    recent = [
      { id: 'req-ready', question_types: [{ slot: 'maths.A.Q1a' }], assessment_papers: [{ status: 'ready', edited_from: null }, { status: 'generating', edited_from: 'p-1' }] },
      { id: 'req-failed', question_types: [{ slot: 'maths.A.Q1a' }], assessment_papers: [{ status: 'failed', edited_from: null }] },
      // The teacher's own paper (no pattern) still being made is not a pattern paper.
      { id: 'req-own', question_types: [{ id: 'MCQs', count: 10 }], assessment_papers: [] },
    ];
    const { statusCode } = await invoke('/assessment/create', { ...PATTERN, scope: 'fde' });
    expect(statusCode).toBe(202);
  });

  test('findGenerating read error → no 409', async () => {
    recent = new Error('statement timeout');
    const { statusCode } = await invoke('/assessment/create', { ...PATTERN, scope: 'fde' });
    expect(statusCode).toBe(202);
    expect(queued).toHaveLength(1);
  });

  test('no pattern → createAndQueue called identically to today', async () => {
    const AssessmentRequest = require('../../bot/shared/services/assessment/assessment-request.service');
    const spy = jest.spyOn(AssessmentRequest, 'createAndQueue');
    const { statusCode } = await invoke('/assessment/create', {
      userId: 'teacher-1', grade: 5, subject: 'maths', chapterNumbers: [2, 3], questionCount: 10,
      questionTypes: [{ id: 'MCQs', count: 6 }, { id: 'Short Questions', count: 4 }], totalMarks: 20,
    });
    expect(statusCode).toBe(202);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Object.keys(spy.mock.calls[0][0]).sort()).toEqual([
      'answerLines', 'chapterNumber', 'chapterNumbers', 'contentSource', 'grade', 'includeAnswerKey', 'outputFormat',
      'pageRanges', 'questionCount', 'questionTypes', 'seenCount', 'subject', 'surface', 'textbookId', 'totalMarks', 'userId',
    ]);
    expect(spy.mock.calls[0][0]).toEqual({
      userId: 'teacher-1', surface: 'portal', grade: 5, subject: 'maths', textbookId: 'book-g5-maths',
      chapterNumber: null, chapterNumbers: [2, 3], pageRanges: '14-40, 42-66', contentSource: 'unseen',
      questionCount: 10, seenCount: null, totalMarks: 20,
      questionTypes: [{ id: 'MCQs', count: 6, category: 'objective' }, { id: 'Short Questions', count: 4, category: 'subjective' }],
      includeAnswerKey: true, answerLines: true, outputFormat: 'pdf',
    });
    // Without a pattern the flag is not read and the guard does not run.
    expect(reads).toEqual([]);
    const supabase = require('../../bot/shared/config/supabase');
    // `users`: her region, for her curriculum's books (bd-97daxo.4). An ICT teacher's request is otherwise
    // exactly today's — the createAndQueue call above has no curriculum key.
    expect(supabase.from.mock.calls.map((c) => c[0])).toEqual(['users', 'assessment_requests']);
  });

  test('job payload carries pattern and scope; a non-pattern payload has neither key', async () => {
    await invoke('/assessment/create', { ...PATTERN, scope: 'fde' });
    expect(job()).toHaveProperty('pattern', 'fde_g5_2027');
    expect(job()).toHaveProperty('scope.kind', 'fde');
    // The row is today's row: no column learns about the pattern.
    expect(Object.keys(row())).not.toEqual(expect.arrayContaining(['pattern']));
    expect(Object.keys(row())).not.toEqual(expect.arrayContaining(['scope']));

    queued = [];
    await invoke('/assessment/create', { userId: 'teacher-1', grade: 5, subject: 'maths', chapterNumbers: [2], questionCount: 5 });
    expect(Object.keys(job())).not.toContain('pattern');
    expect(Object.keys(job())).not.toContain('scope');
    expect(JSON.stringify(job())).not.toMatch(/"pattern"|"scope"/);
  });

  test('every subject\'s generateTotal fits the question_count CHECK (≤ 60)', async () => {
    const Patterns = require('../../bot/shared/services/assessment/patterns');
    for (const subject of ['maths', 'science', 'english', 'urdu', 'social_studies']) {
      const total = Patterns.summaryFor('fde_g5_2027', subject).generateTotal;
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(60);
      inserts = []; queued = [];
      // eslint-disable-next-line no-await-in-loop
      await invoke('/assessment/create', { ...PATTERN, subject, scope: 'fde' });
      expect(row().question_count).toBe(total);
    }
  });
});

describe('findGenerating', () => {
  test('takes a Date or epoch `now` and defaults to ten minutes', async () => {
    const { findGenerating } = require('../../bot/shared/services/assessment/assessment-request.service');
    recent = [];
    expect(await findGenerating({ userId: 'u', grade: 5, subject: 'science', now: new Date('2026-10-15T12:00:00Z') })).toBeNull();
    expect(reads[0].gte).toEqual(['created_at', '2026-10-15T11:50:00.000Z']);
  });

  test('a request with no paper row blocks only while it could still be waiting in the queue', async () => {
    const { findGenerating } = require('../../bot/shared/services/assessment/assessment-request.service');
    const now = new Date('2026-10-15T12:00:00Z');
    // Queued a minute ago: the worker has not picked it up yet — busy.
    recent = [{ id: 'req-fresh', created_at: '2026-10-15T11:59:00Z', question_types: [{ slot: 'maths.A.Q1a' }], assessment_papers: [] }];
    expect(await findGenerating({ userId: 'u', grade: 5, subject: 'maths', now })).toEqual({ id: 'req-fresh' });
    // Eight minutes and still no paper row: its job never reached a worker (the enqueue failed
    // after the row was written). It must not lock the teacher out for the rest of ten minutes.
    recent = [{ id: 'req-orphan', created_at: '2026-10-15T11:52:00Z', question_types: [{ slot: 'maths.A.Q1a' }], assessment_papers: [] }];
    expect(await findGenerating({ userId: 'u', grade: 5, subject: 'maths', now })).toBeNull();
  });

  test('findGenerating ignores a generating row whose updated_at is older than 6 min', async () => {
    const { findGenerating } = require('../../bot/shared/services/assessment/assessment-request.service');
    const now = new Date('2026-10-15T12:00:00Z');
    const paper = (updatedAt) => [{
      id: 'req-busy', created_at: '2026-10-15T11:52:00Z', question_types: [{ slot: 'maths.A.Q1a' }],
      assessment_papers: [{ status: 'generating', edited_from: null, updated_at: updatedAt }],
    }];
    // Written two minutes ago: a run is alive (the worker touches the row every minute) — busy.
    recent = paper('2026-10-15T11:58:00Z');
    expect(await findGenerating({ userId: 'u', grade: 5, subject: 'maths', now })).toEqual({ id: 'req-busy' });
    // Silent seven minutes: the run that owned it is gone (a deploy killed it). A re-tap must not
    // be pointed at a paper nobody is writing.
    recent = paper('2026-10-15T11:53:00Z');
    expect(await findGenerating({ userId: 'u', grade: 5, subject: 'maths', now })).toBeNull();
    // The read asks for the column it judges by.
    expect(reads[reads.length - 1].select).toMatch(/assessment_papers\(status, edited_from, updated_at\)/);
  });

  test('a re-tap on a class whose paper went silent > 6 min gets 202, not 409', async () => {
    // NOW_ISO is 10:00; the paper was last written at 09:52.
    recent = [{
      id: 'req-dead', created_at: '2026-10-15T09:51:00Z', question_types: [{ slot: 'maths.A.Q1a' }],
      assessment_papers: [{ status: 'generating', edited_from: null, updated_at: '2026-10-15T09:52:00Z' }],
    }];
    const { statusCode } = await invoke('/assessment/create', { ...PATTERN, scope: 'fde' });
    expect(statusCode).toBe(202);
    expect(queued).toHaveLength(1);
  });
});
