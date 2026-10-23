/**
 * bd-pw1ccr.1 — a paper made from the Class Quiz Traffic Light report's button says so on its request
 * (assessment_requests.origin = 'report'), so the EG A/B test can count it. Any other door stores nothing.
 */
const KEY = 'origin-key';
let router;
let created;

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

const BASE = { userId: 'teacher-1', grade: 3, subject: 'english', chapterNumbers: [4], questionCount: 6 };

describe('POST /assessment/create carries origin', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = KEY;
    created = null;
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../../bot/shared/services/assessment/assessment-browse.service', () => ({
      bookFor: jest.fn(async () => ({ id: 'book-1', total_pages: 120 })),
      listChapters: jest.fn(async () => [{ chapter_number: 4, chapter_title: 'Ch', page_start: 58, page_end: 95 }]),
    }));
    jest.doMock('../../../bot/shared/services/assessment/assessment-request.service', () => ({
      createAndQueue: jest.fn(async (args) => { created = args; return { requestId: 'req-1' }; }),
    }));
    router = require('../../../bot/shared/routes/internal-api.routes');
  });

  afterEach(() => {
    delete process.env.INTERNAL_API_KEY;
    jest.resetModules();
  });

  test("origin 'report' reaches createAndQueue", async () => {
    const r = await invoke('/assessment/create', { ...BASE, origin: 'report' });
    expect(r.statusCode).toBe(202);
    expect(created.origin).toBe('report');
  });

  test('no origin: none is passed', async () => {
    const r = await invoke('/assessment/create', BASE);
    expect(r.statusCode).toBe(202);
    expect(created.origin ?? null).toBeNull();
  });

  test('an unknown origin: 400, nothing queued', async () => {
    const r = await invoke('/assessment/create', { ...BASE, origin: 'banner' });
    expect(r.statusCode).toBe(400);
    expect(r.payload.error).toBe('Unknown origin.');
    expect(created).toBeNull();
  });
});

describe('createAndQueue stores origin', () => {
  let insert;
  let Svc;
  beforeEach(() => {
    jest.resetModules();
    insert = jest.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => ({ insert })) }));
    jest.doMock('../../../bot/shared/services/queue', () => ({ queueJob: jest.fn(async () => true) }));
    Svc = jest.requireActual('../../../bot/shared/services/assessment/assessment-request.service');
  });
  const spec = { userId: 'u', surface: 'portal', grade: 3, subject: 'english', textbookId: 'b', questionCount: 6, chapterNumber: 4 };

  test("origin 'report' is written on the row; without it the row has no origin key", async () => {
    await Svc.createAndQueue({ ...spec, origin: 'report' });
    expect(insert.mock.calls[0][0].origin).toBe('report');
    await Svc.createAndQueue(spec);
    expect(insert.mock.calls[1][0]).not.toHaveProperty('origin');
  });

  test('an unknown origin throws and writes nothing', async () => {
    await expect(Svc.createAndQueue({ ...spec, origin: 'banner' })).rejects.toThrow('unknown origin: banner');
    expect(insert).not.toHaveBeenCalled();
  });
});
