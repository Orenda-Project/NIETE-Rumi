/**
 * AG row 21 (Hafsa; Amena 21 Nov: a tick-list) — the portal shows a chapter's own exercise questions and she ticks
 * the ones she wants.
 *
 *   POST /api/internal/assessment/exercises  { grade, subject, chapterNumbers } → { success, enabled, chapters }
 *   POST /api/internal/assessment/create     takes seenPicked: [{ chapter, ref, text, type }] on Seen and Mix papers;
 *                                            they become her Seen counts per type and ride to the generator.
 * Behind app_settings assessment_book_picker_enabled: off, the list is empty and seenPicked is ignored.
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
const PICK = (over = {}) => ({ chapter: 1, ref: 'Exercise 1 · Q1', text: 'What do plants need?', type: 'Brief Answers', ...over });

let pickerOn;
let listed;

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  created = null;
  pickerOn = true;
  listed = null;
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
  jest.doMock('../../bot/shared/config/feature-flags', () => ({
    ...jest.requireActual('../../bot/shared/config/feature-flags'),
    isFlagEnabled: jest.fn(async (key) => (key === 'assessment_book_picker_enabled' ? pickerOn : false)),
  }));
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    bookFor: jest.fn(async () => ({ id: 'book-1', total_pages: 60 })),
    listChapters: jest.fn(async () => [
      { chapter_number: 1, chapter_title: 'One', page_start: 2, page_end: 10 },
      { chapter_number: 2, chapter_title: 'Two', page_start: 11, page_end: 20 },
    ]),
    questionOptions: jest.fn(() => ({ types: [{ id: 'MCQs', category: 'objective' }] })),
    listGrades: jest.fn(async () => [{ grade: 4 }]),
    listSubjects: jest.fn(async () => []),
  }));
  jest.doMock('../../bot/shared/services/assessment/book-exercises.service', () => ({
    listExercises: jest.fn(async (args) => {
      listed = args;
      return { chapters: [{ chapterNumber: 1, title: 'One', exercises: [{ ref: 'Q1', heading: null, text: 'What?', type: 'MCQs', page: 3 }] }] };
    }),
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

describe('POST /assessment/exercises', () => {
  test('on: her chapters\' exercise questions', async () => {
    const { statusCode, payload } = await invoke('/assessment/exercises', { ...BASE, chapterNumbers: [1] });
    expect(statusCode).toBe(200);
    expect(payload.enabled).toBe(true);
    expect(payload.chapters[0].exercises[0].text).toBe('What?');
    expect(listed).toMatchObject({ grade: 4, subject: 'science', chapterNumbers: [1] });
  });

  test('off: nothing to tick, and no model call', async () => {
    pickerOn = false;
    const { statusCode, payload } = await invoke('/assessment/exercises', BASE);
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, enabled: false, chapters: [] });
    expect(listed).toBeNull();
  });

  test('no chapters, or no grade, is a 400', async () => {
    expect((await invoke('/assessment/exercises', { ...BASE, chapterNumbers: [] })).statusCode).toBe(400);
    expect((await invoke('/assessment/exercises', { ...BASE, grade: null })).statusCode).toBe(400);
  });
});

describe('options offers the picker', () => {
  test('on: bookPicker true for a grade + subject', async () => {
    const { payload } = await invoke('/assessment/options', { grade: 4, subject: 'science' });
    expect(payload.bookPicker).toBe(true);
  });
  test('off: no key at all, so the options JSON is unchanged', async () => {
    pickerOn = false;
    const { payload } = await invoke('/assessment/options', { grade: 4, subject: 'science' });
    expect('bookPicker' in payload).toBe(false);
  });
});

describe('create with seenPicked', () => {
  test('Seen: the paper is exactly her picks, counted per type', async () => {
    const { statusCode } = await create({
      contentSource: 'seen', questionCount: 20,
      seenPicked: [PICK(), PICK({ ref: 'Q2', text: 'Pick one: (a) sun (b) moon', type: 'MCQs' }), PICK({ ref: 'Q3', text: 'Name a root.' })],
    });
    expect(statusCode).toBe(202);
    expect(created.questionCount).toBe(3);
    expect(created.seenTypes).toEqual([
      { id: 'Brief Answers', count: 2, category: 'subjective' },
      { id: 'MCQs', count: 1, category: 'objective' },
    ]);
    expect(created.seenPicked.map((p) => p.ref)).toEqual(['Exercise 1 · Q1', 'Q2', 'Q3']);
  });

  test('Mix: her picks are the Seen part; Unseen types fill the rest', async () => {
    const { statusCode } = await create({ contentSource: 'both', questionCount: 10, seenPicked: [PICK(), PICK({ ref: 'Q2', text: 'Name a root.' })] });
    expect(statusCode).toBe(202);
    expect(created).toMatchObject({ questionCount: 10, seenCount: 2 });
    expect(sum(created.questionTypes)).toBe(8);
  });

  test('picks win over seenTypes the page also sent', async () => {
    await create({ contentSource: 'seen', seenTypes: [{ id: 'MCQs', count: 9 }], seenPicked: [PICK()] });
    expect(created.seenTypes).toEqual([{ id: 'Brief Answers', count: 1, category: 'subjective' }]);
  });

  test('a pick from a chapter not on the paper is refused', async () => {
    const { statusCode } = await create({ contentSource: 'seen', seenPicked: [PICK({ chapter: 2 })] });
    expect(statusCode).toBe(400);
    expect(created).toBeNull();
  });

  test('a pick of a type this subject does not have is refused', async () => {
    const { statusCode } = await create({ contentSource: 'seen', seenPicked: [PICK({ type: 'Word Problems' })] });
    expect(statusCode).toBe(400);
  });

  test('off: seenPicked is ignored and the request is today\'s', async () => {
    pickerOn = false;
    await create({ contentSource: 'seen', questionCount: 7, seenPicked: [PICK()] });
    expect(created.questionCount).toBe(7);
    expect('seenPicked' in created).toBe(false);
    expect('seenTypes' in created).toBe(false);
  });

  test('an Unseen paper ignores seenPicked', async () => {
    await create({ contentSource: 'unseen', questionCount: 6, seenPicked: [PICK()] });
    expect('seenPicked' in created).toBe(false);
  });
});

test('the portal server forwards seenPicked and has the exercises route', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
  const start = src.indexOf("router.post('/assessment/generate'");
  expect(src.slice(start, src.indexOf('});', start))).toMatch(/seenPicked:\s*body\.seenPicked/);
  expect(src).toMatch(/router\.get\('\/assessment\/exercises'/);
});
