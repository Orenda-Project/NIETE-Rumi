/**
 * Three board-pattern creates for one class at the same instant make ONE paper.
 *
 * The 409 guard reads "is a paper for this class being made?" and then inserts. Run three times at
 * once (a retry after a timed-out POST, or Check open in two tabs), all three reads finish before
 * any insert lands, so all three were let through: three papers, three spends. The read and the
 * insert are now taken one at a time per class, and a request inside the same short window answers
 * 409 with the first request's id even when the database read could not see it yet.
 *
 * Same harness as fde-create.test.js: the real route stack and request service, the database and
 * queue mocked at their boundary. The generating-guard read returns NO rows for every call here, so
 * only the route's own serialisation can tell the second request about the first.
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
  b.single = async () => (row ? { data: { id: `req-${inserts.length}` }, error: null } : { data: null, error: null });
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

describe('POST /assessment/create — three at once', () => {
  test('three parallel pattern creates on one class → one 202, two 409 carrying the first requestId', async () => {
    const outs = await Promise.all([1, 2, 3].map(() => invoke('/assessment/create', { ...PATTERN, scope: 'fde' })));
    const accepted = outs.filter((o) => o.statusCode === 202);
    const refused = outs.filter((o) => o.statusCode === 409);
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(2);
    const first = accepted[0].payload.requestId;
    refused.forEach((o) => expect(o.payload).toMatchObject({ success: false, errorCode: 'ALREADY_GENERATING', requestId: first }));
    expect(inserts.filter((i) => i.table === 'assessment_requests')).toHaveLength(1);
    expect(queued).toHaveLength(1);
  });

  test('two classes at once are not serialised against each other', async () => {
    const outs = await Promise.all([
      invoke('/assessment/create', { ...PATTERN, scope: 'fde' }),
      invoke('/assessment/create', { ...PATTERN, subject: 'science', scope: 'fde' }),
    ]);
    expect(outs.map((o) => o.statusCode)).toEqual([202, 202]);
  });

  test('two teachers on the same class each get a paper', async () => {
    const outs = await Promise.all([
      invoke('/assessment/create', { ...PATTERN, scope: 'fde' }),
      invoke('/assessment/create', { ...PATTERN, userId: 'teacher-2', scope: 'fde' }),
    ]);
    expect(outs.map((o) => o.statusCode)).toEqual([202, 202]);
  });

  test('after the window, with the database showing nothing in flight, a new paper is allowed', async () => {
    const one = await invoke('/assessment/create', { ...PATTERN, scope: 'fde' });
    jest.setSystemTime(new Date(Date.parse(NOW_ISO) + 60 * 1000));
    const two = await invoke('/assessment/create', { ...PATTERN, scope: 'fde' });
    expect([one.statusCode, two.statusCode]).toEqual([202, 202]);
  });

  test('a plain (non-pattern) create is never refused by the window', async () => {
    const plain = { userId: 'teacher-1', grade: 5, subject: 'maths', chapterNumbers: [1] };
    const outs = await Promise.all([invoke('/assessment/create', plain), invoke('/assessment/create', plain)]);
    expect(outs.map((o) => o.statusCode)).toEqual([202, 202]);
  });
});
