/**
 * bd-fmf24g.6 — the portal can ask for every paper WhatsApp can (Word aside: its flag is off).
 *
 * The WhatsApp Flow already lets a teacher set how many Seen questions on a Mix paper, how many of
 * each Unseen type, and a total-marks budget; it hands them to AssessmentRequest.createAndQueue()
 * as `seenCount`, per-type `questionTypes` ({ id, count, category }) and `totalMarks`. The portal's
 * path (POST /api/portal/assessment/generate → POST /api/internal/assessment/create) dropped all
 * three: the create route never read them and always re-spread the paper over the types. These
 * tests hold the create route to the Flow's own rules (question-types.js parsers, planCounts()):
 *
 *   - totalMarks: optional; a number she gave is held to 1..MAX_TOTAL_MARKS and refused otherwise.
 *   - Mix ('both') + seenCount: Seen leaves room for at least one Unseen question; the Unseen types
 *     are sized to questionCount − seenCount, so planCounts() makes a paper of questionCount.
 *   - Per-type counts are hers — used as given, never re-spread — and must add up to the Unseen part.
 *
 * And the portal server forwards seenCount and totalMarks (it already forwards questionTypes).
 */

const fs = require('fs');
const path = require('path');

const KEY = 'shared-secret-key';
let router;
let created;

const CHAPTERS = [
  { chapter_number: 1, chapter_title: 'One', page_start: 2, page_end: 10 },
  { chapter_number: 2, chapter_title: 'Two', page_start: 11, page_end: 20 },
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

const BASE = { userId: 'teacher-1', grade: 4, subject: 'science', chapterNumbers: [1] };
const sum = (types) => types.reduce((s, t) => s + t.count, 0);

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

describe('POST /api/internal/assessment/create — total marks', () => {
  test('a marks budget reaches the request', async () => {
    const { statusCode } = await invoke('/assessment/create', { ...BASE, questionCount: 15, totalMarks: 40 });
    expect(statusCode).toBe(202);
    expect(created).toMatchObject({ totalMarks: 40 });
  });

  test('no budget is null, not a number', async () => {
    await invoke('/assessment/create', { ...BASE, questionCount: 15 });
    expect(created.totalMarks).toBeNull();
  });

  test.each([[0], [1001], ['abc'], [-5]])('a budget of %p is refused and nothing is queued', async (marks) => {
    const { statusCode, payload } = await invoke('/assessment/create', { ...BASE, questionCount: 15, totalMarks: marks });
    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
    expect(created).toBeNull();
  });
});

describe('POST /api/internal/assessment/create — Mix and the Seen count', () => {
  test('Mix + seenCount: the count reaches the request and the Unseen types fill the rest', async () => {
    const { statusCode } = await invoke('/assessment/create', {
      ...BASE, contentSource: 'both', questionCount: 15, seenCount: 5,
    });
    expect(statusCode).toBe(202);
    expect(created).toMatchObject({ contentSource: 'both', questionCount: 15, seenCount: 5 });
    expect(sum(created.questionTypes)).toBe(10);
  });

  test('Seen may not take the whole paper', async () => {
    const { statusCode } = await invoke('/assessment/create', {
      ...BASE, contentSource: 'both', questionCount: 10, seenCount: 10,
    });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });

  test('a Seen count on a paper that is not Mix is not carried', async () => {
    await invoke('/assessment/create', { ...BASE, contentSource: 'unseen', questionCount: 12, seenCount: 4 });
    expect(created.seenCount).toBeNull();
    expect(sum(created.questionTypes)).toBe(12);
  });
});

describe('POST /api/internal/assessment/create — how many of each type', () => {
  test('her counts are used as given, each with its category', async () => {
    const { statusCode } = await invoke('/assessment/create', {
      ...BASE,
      contentSource: 'unseen',
      questionCount: 10,
      questionTypes: [{ id: 'MCQs', count: 4 }, { id: 'True/False', count: 3 }, { id: 'Brief Answers', count: 3 }],
    });
    expect(statusCode).toBe(202);
    expect(created.questionTypes).toEqual([
      { id: 'MCQs', count: 4, category: 'objective' },
      { id: 'True/False', count: 3, category: 'objective' },
      { id: 'Brief Answers', count: 3, category: 'subjective' },
    ]);
  });

  test('on Mix the counts add up to the Unseen part', async () => {
    const { statusCode } = await invoke('/assessment/create', {
      ...BASE,
      contentSource: 'both',
      questionCount: 15,
      seenCount: 5,
      questionTypes: [{ id: 'MCQs', count: 6 }, { id: 'Brief Answers', count: 4 }],
    });
    expect(statusCode).toBe(202);
    expect(created).toMatchObject({ questionCount: 15, seenCount: 5 });
    expect(sum(created.questionTypes)).toBe(10);
  });

  test('counts that do not add up are refused', async () => {
    const { statusCode } = await invoke('/assessment/create', {
      ...BASE, contentSource: 'unseen', questionCount: 10, questionTypes: [{ id: 'MCQs', count: 4 }],
    });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });

  test('a type this subject does not have is refused', async () => {
    const { statusCode } = await invoke('/assessment/create', {
      ...BASE, contentSource: 'unseen', questionCount: 5, questionTypes: [{ id: 'Word Problems', count: 5 }],
    });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });

  test('a count below one is refused', async () => {
    const { statusCode } = await invoke('/assessment/create', {
      ...BASE, contentSource: 'unseen', questionCount: 5,
      questionTypes: [{ id: 'MCQs', count: 5 }, { id: 'True/False', count: 0 }],
    });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });

  test('type names alone still spread the paper over them (today\'s behaviour)', async () => {
    await invoke('/assessment/create', {
      ...BASE, contentSource: 'unseen', questionCount: 9, questionTypes: ['MCQs', 'True/False', 'Brief Answers'],
    });
    expect(created.questionTypes.map((t) => t.count)).toEqual([3, 3, 3]);
  });
});

describe('the portal server forwards the new options', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
  const start = src.indexOf("router.post('/assessment/generate'");
  const handler = src.slice(start, src.indexOf('});', start));

  test('seenCount', () => { expect(handler).toMatch(/seenCount:\s*body\.seenCount/); });
  test('totalMarks', () => { expect(handler).toMatch(/totalMarks:\s*body\.totalMarks/); });
});
