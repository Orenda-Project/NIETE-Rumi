/**
 * bd-6clakk.12.2 — question stems through the internal API.
 * /assessment/options adds `stems` to each type only while topic papers are on (off = today's JSON).
 * /assessment/create keeps her ticked stems on a topic paper's types, as text; a chapter paper drops them.
 */
const KEY = 'topic-stems-key';
let router;
let created;
let topicsOn;

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

const topic = (n, pages) => ({
  topicId: `1-english-4-t${n}`, grade: 1, subject: 'english', chapterNumber: 4, chapterTitle: 'Ch',
  name: `Topic ${n}`, heading: 'Grammar', headingOrder: 1, sortOrder: n, pages,
  sloCodes: [`E-${n}`], sloDescriptions: [`Skill ${n}`], days: [n], isCurrent: true,
});
const TOPICS = [topic(1, [58, 59]), topic(2, [60, 61]), topic(3, [90, 91])];
const BASE = { userId: 'teacher-1', grade: 1, subject: 'english', chapterNumbers: [4], questionCount: 6 };
const SUBSET = { ...BASE, topicIds: [TOPICS[0].topicId] };

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  created = null;
  topicsOn = true;
  const QT = jest.requireActual('../../../bot/shared/services/assessment/question-types');
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
  jest.doMock('../../../bot/shared/config/feature-flags', () => ({
    ...jest.requireActual('../../../bot/shared/config/feature-flags'),
    isAssessmentTopicCtaEnabled: jest.fn(async () => topicsOn),
    isAssessmentFdePatternEnabled: jest.fn(async () => false),
  }));
  jest.doMock('../../../bot/shared/services/assessment/assessment-browse.service', () => ({
    listGrades: jest.fn(async () => [1, 2, 3]),
    listSubjects: jest.fn(async () => ['english']),
    questionOptions: (subject, grade) => ({ types: QT.forSubject(subject, grade), maxQuestions: 50, defaultQuestions: 15 }),
    bookFor: jest.fn(async () => ({ id: 'book-1', total_pages: 120 })),
    listChapters: jest.fn(async () => [{ chapter_number: 4, chapter_title: 'Ch', page_start: 58, page_end: 95 }]),
  }));
  jest.doMock('../../../bot/shared/services/assessment/assessment-request.service', () => ({
    createAndQueue: jest.fn(async (args) => { created = args; return { requestId: 'req-1' }; }),
  }));
  jest.doMock('../../../bot/shared/services/assessment/topics/topics.repo', () => ({
    ...jest.requireActual('../../../bot/shared/services/assessment/topics/topics.repo'),
    listChapterTopics: jest.fn(async () => TOPICS),
  }));
  router = require('../../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('options', () => {
  test('topic papers on: a type with stems carries them, one without is unchanged', async () => {
    const { payload } = await invoke('/assessment/options', { grade: 1, subject: 'english' });
    const fill = payload.types.find((t) => t.id === 'Fill in the Blanks');
    expect(fill.stems.map((s) => s.id)).toContain('is-am-are');
    expect(payload.types.find((t) => t.id === 'Listening')).toEqual({ id: 'Listening', category: 'objective' });
  });

  test('topic papers off: no type carries stems', async () => {
    topicsOn = false;
    const { payload } = await invoke('/assessment/options', { grade: 1, subject: 'english' });
    expect(payload.types.length).toBeGreaterThan(0);
    expect(payload.types.some((t) => 'stems' in t)).toBe(false);
  });
});

describe('create', () => {
  const typesWith = (stems) => [
    { id: 'Fill in the Blanks', count: 4, ...(stems ? { stems } : {}) },
    { id: 'MCQs', count: 2 },
  ];

  test('a topic paper keeps her ticked stems on that type, as text in her order', async () => {
    const { statusCode } = await invoke('/assessment/create', { ...SUBSET, questionTypes: typesWith(['has-have', 'is-am-are']) });
    expect(statusCode).toBe(202);
    expect(created.paperKind).toBe('topic');
    expect(created.questionTypes[0]).toEqual({
      id: 'Fill in the Blanks', count: 4, category: 'objective',
      stems: ['Fill in the blanks with has or have.', 'Fill in the blanks with is, am or are.'],
    });
    expect(created.questionTypes[1]).toEqual({ id: 'MCQs', count: 2, category: 'objective' });
  });

  test('Rumi chooses (no stems, or an empty list) stores the types exactly as before', async () => {
    await invoke('/assessment/create', { ...SUBSET, questionTypes: typesWith(null) });
    const before = created.questionTypes;
    await invoke('/assessment/create', { ...SUBSET, questionTypes: typesWith([]) });
    expect(created.questionTypes).toEqual(before);
    expect(before.some((t) => 'stems' in t)).toBe(false);
  });

  test('a stem that is not in the bank for that type is refused', async () => {
    const { statusCode, payload } = await invoke('/assessment/create', { ...SUBSET, questionTypes: typesWith(['made-up']) });
    expect(statusCode).toBe(400);
    expect(payload.error).toMatch(/made-up/);
    expect(created).toBeNull();
  });

  test('every topic ticked is a whole-chapter paper, and still keeps her stems', async () => {
    const all = { ...BASE, topicIds: TOPICS.map((t) => t.topicId) };
    const { statusCode } = await invoke('/assessment/create', { ...all, questionTypes: typesWith(['is-am-are']) });
    expect(statusCode).toBe(202);
    expect(created.paperKind).toBeUndefined();
    expect(created.questionTypes[0].stems).toEqual(['Fill in the blanks with is, am or are.']);
  });

  test('a chapter paper drops the stems: its request is the one without them', async () => {
    await invoke('/assessment/create', { ...BASE, questionTypes: typesWith(null) });
    const plain = created;
    await invoke('/assessment/create', { ...BASE, questionTypes: typesWith(['is-am-are']) });
    expect(created).toEqual(plain);
  });
});
