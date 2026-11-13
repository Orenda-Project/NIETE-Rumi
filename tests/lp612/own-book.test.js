'use strict';
/**
 * bd-snkn32.19 (unified spec item 13) — her book's pages for "Make my own", grades 1–12. The page TEXT comes from the
 * imported textbook (book-content.service, stubbed here); page images for grades 1–5 do not exist, so this never
 * offers one. A book that is not imported is "not loaded", never a stand-in.
 */
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const { createOwnBook, bookCode, splitPages, parseRange } = require('../../bot/shared/services/lp-own-book');

const fail = (code, extra = {}) => Object.assign(new Error(code), { code }, extra);
const assemble = (pages) => pages.map((p) => `=== Page ${p} ===\ntext of ${p}`).join('\n\n');

function make(over = {}) {
  const calls = [];
  const d = {
    k5Lesson: async (id) => (id === 'g3_maths_d4'
      ? { lessonId: id, lang: 'en', grade: 3, subject: 'math', subjectName: 'Maths', pages: { start: 24, end: 25 } }
      : null),
    loadSegment: async (id) => ({
      'grade_8_science.c01.p001-003': { segment_id: id, grade: 8, subject: 'General Science', curriculum: 'ict', printed_page_start: 1, printed_page_end: 3 },
      'gb.seg': { segment_id: id, grade: 7, subject: 'English', curriculum: 'nbf_snc', printed_page_start: 4, printed_page_end: 5 },
    }[id] || null),
    loadPageRangeContent: async (q) => {
      calls.push(q);
      const [lo, hi] = q.pageRanges.split('-').map(Number);
      const wanted = []; for (let p = lo; p <= hi; p += 1) wanted.push(p);
      const found = wanted.filter((p) => p !== 25);
      return { content: assemble(found), pagesFound: found, pagesMissing: wanted.filter((p) => !found.includes(p)) };
    },
    ...over,
  };
  return { book: createOwnBook(d), calls };
}

describe('pure helpers', () => {
  it('splits the assembled text back into pages', () => {
    expect(splitPages('=== Page 3 ===\nOne, two.\n\n=== Page 4 ===\nThree.')).toEqual([
      { page: 3, text: 'One, two.' }, { page: 4, text: 'Three.' },
    ]);
    expect(splitPages('')).toEqual([]);
  });
  it('a range is whole numbers, first ≤ last, at most 10 pages', () => {
    expect(parseRange(42, 45)).toEqual({ ok: true, from: 42, to: 45 });
    expect(parseRange('42', '42')).toEqual({ ok: true, from: 42, to: 42 });
    for (const [a, b] of [[5, 4], [0, 2], [1, 11], ['x', 2], [1.5, 2], [null, 2], [1, 1000]]) {
      expect(parseRange(a, b).ok).toBe(false);
    }
  });
  it('book codes: the 1–5 catalog key, and the 6–12 segment subject folded to its book code', () => {
    expect(bookCode(3, 'math')).toBe('maths');
    expect(bookCode(4, 'general_science')).toBe('science');
    expect(bookCode(2, 'general_knowledge_ur')).toBe('general_knowledge');
    expect(bookCode(2, 'general_knowledge_en')).toBe('general_knowledge_en');
    expect(bookCode(8, 'General Science')).toBe('general_science');
    expect(bookCode(7, 'Mathematics')).toBe('maths');
    expect(bookCode(9, 'Pak Studies')).toBe('pakistan_studies');
    expect(bookCode(10, 'Islamiyat')).toBe('islamiat');
    expect(bookCode(9, 'Astrology')).toBeNull();
  });
});

describe('pagesFor', () => {
  it('a grades 1–5 day: her range from her book, a page with no text is missing', async () => {
    const { book, calls } = make();
    const out = await book.pagesFor({ lessonId: 'g3_maths_d4', from: 24, to: 26 });
    expect(calls[0]).toEqual({ grade: 3, subject: 'maths', pageRanges: '24-26', curriculum: 'ict' });
    expect(out).toEqual({ outcome: 'ok', loaded: true, pages: [{ page: 24, text: 'text of 24' }, { page: 26, text: 'text of 26' }], missing: [25] });
  });
  it('no range: the day\'s own pages', async () => {
    const { book, calls } = make();
    await book.pagesFor({ lessonId: 'g3_maths_d4' });
    expect(calls[0].pageRanges).toBe('24-25');
    await book.pagesFor({ segmentId: 'grade_8_science.c01.p001-003' });
    expect(calls[1]).toEqual({ grade: 8, subject: 'general_science', pageRanges: '1-3', curriculum: 'ict' });
  });
  it('more than 10 pages, backwards, or half a range: bad request, the book never read', async () => {
    const { book, calls } = make();
    expect((await book.pagesFor({ lessonId: 'g3_maths_d4', from: 1, to: 11 })).outcome).toBe('bad_request');
    expect((await book.pagesFor({ lessonId: 'g3_maths_d4', from: 9, to: 8 })).outcome).toBe('bad_request');
    expect((await book.pagesFor({ lessonId: 'g3_maths_d4', from: 9 })).outcome).toBe('bad_request');
    expect((await book.pagesFor({ lessonId: 'g3_maths_d4', segmentId: 'x', from: 1, to: 2 })).outcome).toBe('bad_request');
    expect((await book.pagesFor({ from: 1, to: 2 })).outcome).toBe('bad_request');
    expect(calls).toEqual([]);
  });
  it('a worksheet or revision day (k5Lesson null), or an unknown segment: not found', async () => {
    const { book } = make();
    expect((await book.pagesFor({ lessonId: 'g3_revision', from: 1, to: 2 })).outcome).toBe('not_found');
    expect((await book.pagesFor({ segmentId: 'nope', from: 1, to: 2 })).outcome).toBe('not_found');
  });
  it('a book not imported, an unknown subject or a non-ICT segment: not loaded, never a stand-in', async () => {
    const { book: noBook } = make({ loadPageRangeContent: async () => { throw fail('BOOK_NOT_FOUND'); } });
    expect(await noBook.pagesFor({ lessonId: 'g3_maths_d4', from: 1, to: 2 }))
      .toEqual({ outcome: 'ok', loaded: false, pages: [], missing: [] });
    const { book, calls } = make({ k5Lesson: async () => ({ grade: 2, subject: 'social_studies_en' }) });
    expect((await book.pagesFor({ lessonId: 'g2_sst', from: 1, to: 2 })).loaded).toBe(true); // a code: asked, not invented
    const { book: odd, calls: oddCalls } = make({ k5Lesson: async () => ({ grade: 2, subject: 'astrology' }) });
    expect(await odd.pagesFor({ lessonId: 'x', from: 1, to: 2 })).toEqual({ outcome: 'ok', loaded: false, pages: [], missing: [] });
    expect(oddCalls).toEqual([]);
    expect(await book.pagesFor({ segmentId: 'gb.seg' })).toEqual({ outcome: 'ok', loaded: false, pages: [], missing: [] });
    expect(calls.length).toBe(1);
  });
  it('no text on those pages: loaded, every page missing', async () => {
    const { book } = make({ loadPageRangeContent: async () => { throw fail('NO_CONTENT'); } });
    expect(await book.pagesFor({ lessonId: 'g3_maths_d4', from: 7, to: 8 }))
      .toEqual({ outcome: 'ok', loaded: true, pages: [], missing: [7, 8] });
  });
  it('past the end of the book: the pages before the end, the rest missing', async () => {
    let n = 0;
    const { book } = make({
      loadPageRangeContent: async (q) => {
        n += 1;
        if (n === 1) throw fail('PAGE_OUT_OF_RANGE', { totalPages: 41, beyond: [42, 43] });
        expect(q.pageRanges).toBe('40-41');
        return { content: assemble([40, 41]), pagesFound: [40, 41], pagesMissing: [] };
      },
    });
    expect(await book.pagesFor({ lessonId: 'g3_maths_d4', from: 40, to: 43 })).toEqual({
      outcome: 'ok', loaded: true, pages: [{ page: 40, text: 'text of 40' }, { page: 41, text: 'text of 41' }], missing: [42, 43],
    });
    const { book: allPast } = make({ loadPageRangeContent: async () => { throw fail('PAGE_OUT_OF_RANGE', { totalPages: 41 }); } });
    expect((await allPast.pagesFor({ lessonId: 'g3_maths_d4', from: 50, to: 51 })).missing).toEqual([50, 51]);
  });
  it('a database failure is thrown (the route answers 500)', async () => {
    const { book } = make({ loadPageRangeContent: async () => { throw new Error('db down'); } });
    await expect(book.pagesFor({ lessonId: 'g3_maths_d4', from: 1, to: 2 })).rejects.toThrow('db down');
  });
});

describe('bookTextFor (the rewrite\'s feed)', () => {
  it('the joined page text, or null; never throws', async () => {
    const { book } = make();
    expect(await book.bookTextFor({ grade: 3, subject: 'math', from: 24, to: 24 })).toBe('=== Page 24 ===\ntext of 24');
    expect(await book.bookTextFor({ grade: 3, subject: 'math', from: 25, to: 25 })).toBeNull();
    expect(await book.bookTextFor({ grade: 3, subject: 'math' })).toBeNull();
    expect(await book.bookTextFor({ grade: 7, subject: 'English', from: 1, to: 2, curriculum: 'nbf_snc' })).toBeNull();
    const { book: down } = make({ loadPageRangeContent: async () => { throw new Error('db down'); } });
    expect(await down.bookTextFor({ grade: 3, subject: 'math', from: 1, to: 2 })).toBeNull();
  });
  it('a long day is cut to its first 10 pages, not refused', async () => {
    const { book, calls } = make();
    await book.bookTextFor({ grade: 8, subject: 'General Science', from: 1, to: 30 });
    expect(calls[0].pageRanges).toBe('1-10');
  });
});
