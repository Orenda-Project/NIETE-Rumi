/**
 * bd-ix9uhr — a portal paper may cover several chapters.
 *
 * WhatsApp has taken several chapters since assessment-chapter-cap; the portal sent one
 * `chapterNumber` and the bot's create route read nothing else. Now the portal sends
 * `chapterNumbers` and the route does what the Flow's submit() does: one chapter still names
 * itself in `chapter_number`; several leave it null and carry the union of their pages in
 * `page_ranges` — the column the orchestrator already loads several ranges from — so the
 * paper's questions come from every chapter she picked.
 */

const fs = require('fs');
const path = require('path');

const KEY = 'shared-secret-key';
let router;
let created;

/** 1-3 run on from each other, 4 stands apart, 5 and 6 were never paginated on the contents page. */
const CHAPTERS = [
  { chapter_number: 1, chapter_title: 'One', page_start: 2, page_end: 10 },
  { chapter_number: 2, chapter_title: 'Two', page_start: 11, page_end: 20 },
  { chapter_number: 3, chapter_title: 'Three', page_start: 21, page_end: 30 },
  { chapter_number: 4, chapter_title: 'Four', page_start: 40, page_end: 52 },
  { chapter_number: 5, chapter_title: 'Five', page_start: null, page_end: null },
  { chapter_number: 6, chapter_title: 'Six', page_start: null, page_end: null },
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

const BASE = { userId: 'teacher-1', grade: 4, subject: 'science', questionCount: 10 };

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  created = null;
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    bookFor: jest.fn(async () => ({ id: 'book-1', total_pages: 60 })),
    listChapters: jest.fn(async () => CHAPTERS),
  }));
  jest.doMock('../../bot/shared/services/assessment/assessment-request.service', () => ({
    createAndQueue: jest.fn(async (args) => { created = args; return { requestId: 'req-1' }; }),
  }));
  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('POST /api/internal/assessment/create — several chapters', () => {
  test('one chapter still names itself, with its pages', async () => {
    const { statusCode } = await invoke('/assessment/create', { ...BASE, chapterNumber: 2 });
    expect(statusCode).toBe(202);
    expect(created).toMatchObject({ chapterNumber: 2, pageRanges: '11-20' });
  });

  test('chapterNumbers of one is the same paper as chapterNumber', async () => {
    const { statusCode } = await invoke('/assessment/create', { ...BASE, chapterNumbers: [2] });
    expect(statusCode).toBe(202);
    expect(created).toMatchObject({ chapterNumber: 2, chapterNumbers: [2], pageRanges: '11-20' });
  });

  test('several chapters: no single chapter_number, every chapter\'s pages, neighbours merged', async () => {
    const { statusCode, payload } = await invoke('/assessment/create', { ...BASE, chapterNumbers: [4, 1, 2, 3] });
    expect(statusCode).toBe(202);
    expect(payload).toEqual({ success: true, requestId: 'req-1' });
    expect(created).toMatchObject({
      chapterNumber: null,
      chapterNumbers: [1, 2, 3, 4],
      pageRanges: '2-30, 40-52',
      textbookId: 'book-1',
      surface: 'portal',
    });
  });

  test('a repeated chapter counts once', async () => {
    await invoke('/assessment/create', { ...BASE, chapterNumbers: [1, 1, 4] });
    expect(created).toMatchObject({ chapterNumbers: [1, 4], pageRanges: '2-10, 40-52' });
  });

  test('a chapter that is not in the book is refused, and nothing is queued', async () => {
    const { statusCode, payload } = await invoke('/assessment/create', { ...BASE, chapterNumbers: [1, 99] });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
    expect(created).toBeNull();
  });

  test('several chapters with no known pages are refused — there would be nothing to write from', async () => {
    const { statusCode } = await invoke('/assessment/create', { ...BASE, chapterNumbers: [5, 6] });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });

  test('an unpaginated chapter among paginated ones contributes nothing and sinks nothing', async () => {
    await invoke('/assessment/create', { ...BASE, chapterNumbers: [4, 5] });
    expect(created).toMatchObject({ chapterNumber: null, chapterNumbers: [4, 5], pageRanges: '40-52' });
  });

  test('an empty chapterNumbers with nothing else is still "chapter or pages required"', async () => {
    const { statusCode } = await invoke('/assessment/create', { ...BASE, chapterNumbers: [] });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });
});

describe('the portal server passes chapterNumbers on', () => {
  test('POST /api/portal/assessment/generate forwards chapterNumbers to the bot', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
    const start = src.indexOf("router.post('/assessment/generate'");
    const handler = src.slice(start, src.indexOf('});', start));
    expect(handler).toMatch(/chapterNumbers:\s*body\.chapterNumbers/);
  });
});
