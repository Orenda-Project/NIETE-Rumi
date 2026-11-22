/**
 * bd-e5n2jf — the portal asks for Seen questions by type, like Unseen (Mubashar Zia, 20 Nov).
 *
 * POST /api/internal/assessment/create takes `seenTypes: [{ id, count }]` on Seen and Mix papers:
 *   - Seen: the paper is the sum of her Seen counts.
 *   - Mix: the Seen part is that sum, and it must leave room for at least one Unseen question.
 *   - each type must be one this subject offers (board patterns are not Seen types), count ≥ 1.
 * A request without seenTypes is unchanged. The portal server forwards it.
 */
const fs = require('fs');
const path = require('path');

const KEY = 'shared-secret-key';
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
    listChapters: jest.fn(async () => [{ chapter_number: 1, chapter_title: 'One', page_start: 2, page_end: 10 }]),
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

const create = (body) => invoke('/assessment/create', { ...BASE, ...body });

describe('Seen only', () => {
  test('her Seen counts reach the request, each with its category, and make the paper', async () => {
    const { statusCode } = await create({
      contentSource: 'seen', questionCount: 20,
      seenTypes: [{ id: 'MCQs', count: 3 }, { id: 'Brief Answers', count: 2 }],
    });
    expect(statusCode).toBe(202);
    expect(created.seenTypes).toEqual([
      { id: 'MCQs', count: 3, category: 'objective' },
      { id: 'Brief Answers', count: 2, category: 'subjective' },
    ]);
    expect(created.questionCount).toBe(5);
  });

  test('more than the paper can hold is refused', async () => {
    const { statusCode } = await create({ contentSource: 'seen', seenTypes: [{ id: 'MCQs', count: 101 }] });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });
});

describe('Mix', () => {
  test('the Seen part is the sum of her Seen counts; the Unseen types fill the rest', async () => {
    const { statusCode } = await create({
      contentSource: 'both', questionCount: 12, seenTypes: [{ id: 'True/False', count: 4 }],
    });
    expect(statusCode).toBe(202);
    expect(created).toMatchObject({ questionCount: 12, seenCount: 4 });
    expect(created.seenTypes).toEqual([{ id: 'True/False', count: 4, category: 'objective' }]);
    expect(sum(created.questionTypes)).toBe(8);
  });

  test('Seen may not take the whole paper', async () => {
    const { statusCode } = await create({
      contentSource: 'both', questionCount: 5, seenTypes: [{ id: 'MCQs', count: 5 }],
    });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });
});

describe('refusals', () => {
  test('a type this subject does not have', async () => {
    const { statusCode } = await create({ contentSource: 'seen', seenTypes: [{ id: 'Word Problems', count: 2 }] });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });

  test('a count below one', async () => {
    const { statusCode } = await create({
      contentSource: 'seen', seenTypes: [{ id: 'MCQs', count: 2 }, { id: 'True/False', count: 0 }],
    });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });
});

describe('unchanged without seenTypes', () => {
  test('a Seen paper carries no seenTypes key', async () => {
    await create({ contentSource: 'seen', questionCount: 7 });
    expect(created.questionCount).toBe(7);
    expect('seenTypes' in created).toBe(false);
  });

  test('seenTypes on an Unseen paper is ignored', async () => {
    await create({ contentSource: 'unseen', questionCount: 6, seenTypes: [{ id: 'MCQs', count: 2 }] });
    expect('seenTypes' in created).toBe(false);
    expect(sum(created.questionTypes)).toBe(6);
  });
});

test('the portal server forwards seenTypes', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
  const start = src.indexOf("router.post('/assessment/generate'");
  expect(src.slice(start, src.indexOf('});', start))).toMatch(/seenTypes:\s*body\.seenTypes/);
});
