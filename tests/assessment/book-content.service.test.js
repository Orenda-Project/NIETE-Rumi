/**
 * Getting textbook prose out of our own tables and into a shape the model can read.
 *
 * Two ways in, because a teacher has two ways of saying what she wants: a chapter
 * off the contents page, or page numbers she read off the book. Both end in the
 * same thing — pages, in order, with their numbers, which is the format the
 * generation prompts were written against.
 */

const mockResults = [];
const mockCalls = [];

function mockBuilder(table) {
  const state = { table, filters: [] };
  const record = (fn) => (...args) => { state.filters.push({ fn, args }); return builder; };
  const settle = () => {
    mockCalls.push({ ...state, filters: [...state.filters] });
    return Promise.resolve(mockResults.shift() || { data: null, error: null });
  };
  const builder = {
    select: record('select'),
    eq: record('eq'),
    gte: record('gte'),
    lte: record('lte'),
    in: record('in'),
    order: record('order'),
    limit: record('limit'),
    single: () => settle(),
    maybeSingle: () => settle(),
    then: (res, rej) => settle().then(res, rej),
  };
  return builder;
}

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const BookContent = require('../../bot/shared/services/assessment/book-content.service');

const BOOK = { id: 'tb-1', total_pages: 166, pdf_page_offset: 3 };

beforeEach(() => { mockResults.length = 0; mockCalls.length = 0; jest.clearAllMocks(); });

describe('parsePageRanges', () => {
  it.each([
    ['a single page', '12', [12]],
    ['a range', '4-8', [4, 5, 6, 7, 8]],
    ['a mix, sorted and deduped', '10, 3, 5-7, 5', [3, 5, 6, 7, 10]],
    ['whitespace and stray commas', ' 4 - 6 ,, 9 ', [4, 5, 6, 9]],
  ])('parses %s', (_l, input, expected) => {
    expect(BookContent.parsePageRanges(input)).toEqual(expected);
  });

  it.each([
    ['a backwards range', '9-4'],
    ['words', 'chapter one'],
    ['nothing', '   '],
    ['a zero page', '0-3'],
  ])('refuses %s', (_l, input) => {
    expect(() => BookContent.parsePageRanges(input)).toThrow(
      expect.objectContaining({ code: 'INVALID_PAGE_RANGE' }),
    );
  });
});

describe('normaliseSubject', () => {
  it.each([
    ['Eng', 'english'], ['english', 'english'], ['ENGLISH', 'english'],
    ['Maths', 'maths'], ['Urdu', 'urdu'], ['GenK', 'general_knowledge'],
    ['SST', 'social_studies'], ['Science', 'science'], ['Islamiat', 'islamiat'],
  ])('%s -> %s', (input, expected) => {
    expect(BookContent.normaliseSubject(input)).toBe(expected);
  });

  it('returns null for a subject we do not carry', () => {
    expect(BookContent.normaliseSubject('Physics')).toBeNull();
  });
});

describe('listChapters', () => {
  it('returns the chapters a teacher can pick, in order, with their page spans', async () => {
    mockResults.push({ data: BOOK, error: null });
    mockResults.push({
      data: [
        { chapter_number: 1, chapter_title: 'Hello World!', page_start: 4, page_end: 14 },
        { chapter_number: 3, chapter_title: "Pinky's Yummy Tummy Team-Up!", page_start: 28, page_end: 40 },
      ],
      error: null,
    });

    const chapters = await BookContent.listChapters({ grade: 1, subject: 'Eng' });

    expect(chapters).toEqual([
      { chapterNumber: 1, title: 'Hello World!', pageStart: 4, pageEnd: 14, pageCount: 11 },
      { chapterNumber: 3, title: "Pinky's Yummy Tummy Team-Up!", pageStart: 28, pageEnd: 40, pageCount: 13 },
    ]);

    const books = mockCalls.find((c) => c.table === 'textbooks');
    const eqs = books.filters.filter((f) => f.fn === 'eq').map((f) => f.args);
    expect(eqs).toEqual(expect.arrayContaining([
      ['curriculum', 'ict'], ['grade', 1], ['subject', 'english'],
    ]));
  });

  it('throws BOOK_NOT_FOUND when we do not carry that book', async () => {
    mockResults.push({ data: null, error: null });
    await expect(BookContent.listChapters({ grade: 9, subject: 'Eng' }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' });
  });

  it('throws BOOK_NOT_FOUND for a subject outside the curriculum, without querying', async () => {
    await expect(BookContent.listChapters({ grade: 1, subject: 'Physics' }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' });
    expect(mockCalls).toHaveLength(0);
  });
});

describe('loadChapterContent', () => {
  it('assembles the chapter pages into page-marked text', async () => {
    mockResults.push({ data: BOOK, error: null });
    mockResults.push({ data: { chapter_number: 1, chapter_title: 'Hello World!', page_start: 4, page_end: 6 }, error: null });
    mockResults.push({
      data: [
        { textbook_page_number: 4, page_content: 'CHAPTER 1\nHello World!' },
        { textbook_page_number: 5, page_content: 'Activity 2' },
        { textbook_page_number: 6, page_content: 'Activity 3' },
      ],
      error: null,
    });

    const out = await BookContent.loadChapterContent({ grade: 1, subject: 'Eng', chapterNumber: 1 });

    expect(out.pageReference).toBe('4-6');
    expect(out.chapterTitle).toBe('Hello World!');
    expect(out.pageCount).toBe(3);
    expect(out.content).toBe(
      '=== Page 4 ===\nCHAPTER 1\nHello World!\n\n'
      + '=== Page 5 ===\nActivity 2\n\n'
      + '=== Page 6 ===\nActivity 3',
    );
  });

  it('throws NO_CONTENT when the chapter exists but its pages are empty', async () => {
    mockResults.push({ data: BOOK, error: null });
    mockResults.push({ data: { chapter_number: 2, chapter_title: 'Ghost', page_start: 15, page_end: 27 }, error: null });
    mockResults.push({ data: [], error: null });
    await expect(BookContent.loadChapterContent({ grade: 1, subject: 'Eng', chapterNumber: 2 }))
      .rejects.toMatchObject({ code: 'NO_CONTENT' });
  });

  it('throws CHAPTER_NOT_FOUND for a chapter this book does not have', async () => {
    mockResults.push({ data: BOOK, error: null });
    mockResults.push({ data: null, error: null });
    await expect(BookContent.loadChapterContent({ grade: 1, subject: 'Eng', chapterNumber: 2 }))
      .rejects.toMatchObject({ code: 'CHAPTER_NOT_FOUND' });
  });
});

describe('loadPageRangeContent', () => {
  it('assembles exactly the pages asked for, in order', async () => {
    mockResults.push({ data: BOOK, error: null });
    mockResults.push({
      data: [
        { textbook_page_number: 4, page_content: 'four' },
        { textbook_page_number: 9, page_content: 'nine' },
      ],
      error: null,
    });

    const out = await BookContent.loadPageRangeContent({ grade: 1, subject: 'Eng', pageRanges: '4, 9' });

    expect(out.pageReference).toBe('4, 9');
    expect(out.content).toBe('=== Page 4 ===\nfour\n\n=== Page 9 ===\nnine');
    const pages = mockCalls.find((c) => c.table === 'textbook_pages');
    expect(pages.filters.find((f) => f.fn === 'in').args[1]).toEqual([4, 9]);
  });

  it('reports pages the book does not have rather than silently shrinking the request', async () => {
    mockResults.push({ data: BOOK, error: null });
    await expect(BookContent.loadPageRangeContent({ grade: 1, subject: 'Eng', pageRanges: '900' }))
      .rejects.toMatchObject({ code: 'PAGE_OUT_OF_RANGE', totalPages: 166 });
  });

  it('tolerates a gap — asks for 3, gets 2, says which it got', async () => {
    mockResults.push({ data: BOOK, error: null });
    mockResults.push({
      data: [
        { textbook_page_number: 4, page_content: 'four' },
        { textbook_page_number: 6, page_content: 'six' },
      ],
      error: null,
    });
    const out = await BookContent.loadPageRangeContent({ grade: 1, subject: 'Eng', pageRanges: '4-6' });
    expect(out.pagesFound).toEqual([4, 6]);
    expect(out.pagesMissing).toEqual([5]);
    expect(out.content).toContain('=== Page 6 ===');
  });

  it('throws NO_CONTENT when none of the requested pages have text', async () => {
    mockResults.push({ data: BOOK, error: null });
    mockResults.push({ data: [], error: null });
    await expect(BookContent.loadPageRangeContent({ grade: 1, subject: 'Eng', pageRanges: '4-6' }))
      .rejects.toMatchObject({ code: 'NO_CONTENT' });
  });
});
