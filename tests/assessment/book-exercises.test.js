/**
 * AG row 21 (Amena 21 Nov) — a chapter's own exercise questions, for the teacher to tick.
 *
 * The questions are read out of the chapter's page text (no new table), checked against that text so nothing
 * invented reaches her, each given one of the subject's types, and cached per book + chapter.
 */
const PAGES = `=== Page 30 ===
Plants need water, light and air.
Exercise 3.1
1. What do plants need to grow?
2. Fill in the blank: Leaves make ______ for the plant.
=== Page 31 ===
3. Choose the correct answer: Roots take in (a) light (b) water (c) air
4. Plants can walk. True or false?`;

const REPLY = {
  exercises: [
    { heading: 'Exercise 3.1', number: '1', text: 'What do plants need to grow?', type: 'Brief Answers', page: 30 },
    { heading: 'Exercise 3.1', number: '2', text: 'Fill in the blank: Leaves make ______ for the plant.', type: 'Fill in the Blanks', page: 30 },
    { heading: 'Exercise 3.1', number: '3', text: 'Choose the correct answer: Roots take in (a) light (b) water (c) air', type: 'MCQs', page: 31 },
    { heading: 'Exercise 3.1', number: '4', text: 'Plants can walk. True or false?', type: 'Something Else', page: 31 },
    { heading: 'Exercise 3.1', number: '5', text: 'Explain how a rocket reaches the moon.', type: 'Brief Answers', page: 31 },
  ],
};

const TYPES = [
  { id: 'MCQs', category: 'objective' },
  { id: 'Fill in the Blanks', category: 'objective' },
  { id: 'True/False', category: 'objective' },
  { id: 'Brief Answers', category: 'subjective' },
];

let mockCreate;
let mockCache;
let mockLoad;

function load() {
  jest.resetModules();
  mockCache = new Map();
  mockCreate = jest.fn(async () => ({ choices: [{ message: { content: JSON.stringify(REPLY) } }] }));
  mockLoad = jest.fn(async ({ chapterNumber }) => ({ content: PAGES, chapterNumber, chapterTitle: 'Plants', pageReference: '30-31' }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: mockCreate } } }) }));
  jest.doMock('../../bot/shared/config/model-registry', () => ({ resolveModelForJob: () => ({ model: 'test/model' }) }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: jest.fn(async (k) => (mockCache.has(k) ? mockCache.get(k) : null)),
    set: jest.fn(async (k, v) => { mockCache.set(k, v); return true; }),
  }));
  jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({ loadChapterContent: mockLoad }));
  jest.doMock('../../bot/shared/services/assessment/question-types', () => ({ forSubject: () => TYPES }));
  return require('../../bot/shared/services/assessment/book-exercises.service');
}

describe('parseExercises (pure)', () => {
  const { parseExercises } = jest.requireActual('../../bot/shared/services/assessment/book-exercises.service');

  test('keeps only questions printed on the pages, in book order', () => {
    const out = parseExercises(REPLY, PAGES, TYPES);
    expect(out.map((e) => e.text)).not.toContain('Explain how a rocket reaches the moon.');
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ ref: 'Exercise 3.1 · Q1', heading: 'Exercise 3.1', text: 'What do plants need to grow?', type: 'Brief Answers', page: 30 });
  });

  test('a type the subject does not offer becomes its first written type', () => {
    const out = parseExercises(REPLY, PAGES, TYPES);
    expect(out[3].type).toBe('Brief Answers');
  });

  test('small OCR differences in spacing and punctuation still match', () => {
    const out = parseExercises({ exercises: [{ heading: 'Ex', number: '1', text: 'What do plants  need to grow', type: 'Brief Answers' }] }, PAGES, TYPES);
    expect(out).toHaveLength(1);
  });

  test('a reply that is not the expected shape gives no questions', () => {
    expect(parseExercises(null, PAGES, TYPES)).toEqual([]);
    expect(parseExercises({ exercises: 'nope' }, PAGES, TYPES)).toEqual([]);
  });

  test('Urdu text matches the Urdu pages', () => {
    const ur = '=== Page 5 ===\nمشق\n۱۔ پودے کو کیا چاہیے؟';
    const out = parseExercises({ exercises: [{ heading: 'مشق', number: '۱', text: 'پودے کو کیا چاہیے؟', type: 'Brief Answers' }] }, ur, TYPES);
    expect(out).toEqual([{ ref: 'مشق · Q۱', heading: 'مشق', text: 'پودے کو کیا چاہیے؟', type: 'Brief Answers', page: null }]);
  });
});

describe('listExercises', () => {
  test('one model call per chapter, then served from the cache', async () => {
    const Ex = load();
    const first = await Ex.listExercises({ grade: 4, subject: 'science', chapterNumbers: [3] });
    expect(first.chapters).toEqual([{ chapterNumber: 3, title: 'Plants', exercises: expect.any(Array) }]);
    expect(first.chapters[0].exercises).toHaveLength(4);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const again = await Ex.listExercises({ grade: 4, subject: 'science', chapterNumbers: [3] });
    expect(again).toEqual(first);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('several chapters come back in book order, each read once', async () => {
    const Ex = load();
    const out = await Ex.listExercises({ grade: 4, subject: 'science', chapterNumbers: [5, 3, 5] });
    expect(out.chapters.map((c) => c.chapterNumber)).toEqual([3, 5]);
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });

  test('a chapter with no text gives an empty list, not a failure', async () => {
    const Ex = load();
    mockLoad.mockImplementationOnce(async () => { const e = new Error('none'); e.code = 'NO_CONTENT'; throw e; });
    const out = await Ex.listExercises({ grade: 4, subject: 'science', chapterNumbers: [3] });
    expect(out.chapters).toEqual([{ chapterNumber: 3, title: null, exercises: [] }]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('a model failure is thrown (the page says try again), and nothing is cached', async () => {
    const Ex = load();
    mockCreate.mockRejectedValueOnce(new Error('down'));
    await expect(Ex.listExercises({ grade: 4, subject: 'science', chapterNumbers: [3] })).rejects.toThrow();
    expect(mockCache.size).toBe(0);
  });

  test('her curriculum is part of the cache key and reaches the page read', async () => {
    const Ex = load();
    await Ex.listExercises({ grade: 4, subject: 'science', chapterNumbers: [3], curriculum: 'gb' });
    expect(mockLoad.mock.calls[0][0].curriculum).toBe('gb');
    expect([...mockCache.keys()][0]).toMatch(/gb/);
  });
});
