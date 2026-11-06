/**
 * Assessments pick the teacher's curriculum book, else ICT's (bd-97daxo.4).
 *
 * Until a GB book is loaded every teacher — GB included — must see exactly what she sees today.
 * Once one is (a `textbooks` row with curriculum 'nbf_snc'), a GB teacher gets it for that grade and
 * subject, and ICT's book for every other; an ICT teacher never sees it. Nothing in code changes
 * when that row arrives: these tests add the row and nothing else.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const { createMemorySupabase } = require('../fixtures/memory-supabase');
  return createMemorySupabase({});
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ getPresignedUrl: jest.fn(), buildR2PublicUrl: jest.fn() }));

const db = require('../../bot/shared/config/supabase');
const Browse = require('../../bot/shared/services/assessment/assessment-browse.service');
const BookContent = require('../../bot/shared/services/assessment/book-content.service');

const ICT_BOOKS = [
  { id: 'ict-3-english', curriculum: 'ict', grade: 3, subject: 'english', total_pages: 120, pdf_page_offset: 0 },
  { id: 'ict-3-maths', curriculum: 'ict', grade: 3, subject: 'maths', total_pages: 90, pdf_page_offset: 0 },
  { id: 'ict-4-science', curriculum: 'ict', grade: 4, subject: 'science', total_pages: 80, pdf_page_offset: 0 },
  // Already in the live table today: a book the ICT generator cannot read. Never offered.
  { id: 'snc-3-english', curriculum: 'punjab_snc_2020', grade: 3, subject: 'english', total_pages: 99, pdf_page_offset: 0 },
];
const GB_BOOKS = [
  { id: 'nbf-3-english', curriculum: 'nbf_snc', grade: 3, subject: 'english', total_pages: 64, pdf_page_offset: 0 },
  // A grade ICT holds nothing for: only a GB teacher is offered it.
  { id: 'nbf-6-english', curriculum: 'nbf_snc', grade: 6, subject: 'english', total_pages: 50, pdf_page_offset: 0 },
];
const TOC = [
  { textbook_id: 'ict-3-english', chapter_number: 1, chapter_title: 'ICT English One', page_start: 1, page_end: 10 },
  { textbook_id: 'ict-3-english', chapter_number: 2, chapter_title: 'ICT English Two', page_start: 11, page_end: 20 },
  { textbook_id: 'ict-3-maths', chapter_number: 1, chapter_title: 'ICT Maths One', page_start: 1, page_end: 12 },
  { textbook_id: 'nbf-3-english', chapter_number: 1, chapter_title: 'GB English One', page_start: 1, page_end: 8 },
  { textbook_id: 'snc-3-english', chapter_number: 1, chapter_title: 'SNC English One', page_start: 1, page_end: 9 },
];
const PAGES = [
  { textbook_id: 'ict-3-english', textbook_page_number: 1, page_content: 'ict page one' },
  { textbook_id: 'nbf-3-english', textbook_page_number: 1, page_content: 'gb page one' },
];

const seed = (books) => db.reset({ textbooks: books, textbook_toc: TOC, textbook_pages: PAGES });

/** Every call a sector (ICT) teacher's surface makes, in one object. */
async function everything(opts) {
  const args = opts === undefined ? [] : [opts];
  return {
    grades: await Browse.listGrades(...args),
    subjects3: await Browse.listSubjects(3, ...args),
    chapters: await Browse.listChapters(3, 'english', ...args),
    book: await Browse.bookFor(3, 'english', ...args),
    contentChapters: await BookContent.listChapters({ grade: 3, subject: 'english', ...(opts || {}) }),
    content: (await BookContent.loadChapterContent({ grade: 3, subject: 'english', chapterNumber: 1, ...(opts || {}) })).content,
  };
}

describe('an ICT (sector) teacher', () => {
  it('gets exactly what she gets today, with or without a GB book in the table', async () => {
    seed(ICT_BOOKS);
    const today = await everything();
    expect(today.chapters.map((c) => c.chapter_title)).toEqual(['ICT English One', 'ICT English Two']);
    expect(today.book.id).toBe('ict-3-english');

    seed([...ICT_BOOKS, ...GB_BOOKS]);
    expect(await everything()).toEqual(today);
    expect(await everything({ curriculum: 'ict' })).toEqual(today);
  });

  it('is never offered the GB-only grade', async () => {
    seed([...ICT_BOOKS, ...GB_BOOKS]);
    expect(await Browse.listGrades({ curriculum: 'ict' })).toEqual([3, 4]);
  });
});

describe('a GB teacher', () => {
  it("gets GB's book where GB has one, and ICT's for every other grade and subject", async () => {
    seed([...ICT_BOOKS, ...GB_BOOKS]);
    const gb = { curriculum: 'nbf_snc' };

    expect((await Browse.bookFor(3, 'english', gb)).id).toBe('nbf-3-english');
    expect((await Browse.bookFor(3, 'maths', gb)).id).toBe('ict-3-maths');
    expect((await Browse.listChapters(3, 'english', gb)).map((c) => c.chapter_title)).toEqual(['GB English One']);
    expect((await Browse.listChapters(3, 'maths', gb)).map((c) => c.chapter_title)).toEqual(['ICT Maths One']);
    expect(await Browse.listGrades(gb)).toEqual([3, 4, 6]);
    expect((await Browse.listSubjects(3, gb)).map((s) => s.subject_key).sort()).toEqual(['english', 'maths']);

    expect((await BookContent.listChapters({ grade: 3, subject: 'english', ...gb })).map((c) => c.title)).toEqual(['GB English One']);
    const loaded = await BookContent.loadChapterContent({ grade: 3, subject: 'english', chapterNumber: 1, ...gb });
    expect(loaded.content).toContain('gb page one');
    expect(loaded.content).not.toContain('ict page one');
  });

  it('gets ICT exactly, today, while no GB book is loaded', async () => {
    seed(ICT_BOOKS);
    const ict = await everything();
    expect(await everything({ curriculum: 'nbf_snc' })).toEqual(ict);
  });
});
