/**
 * lp612-pagetruth.service — the page-truth retrieval the author service grounds every LP in.
 *
 * Ported from the pipeline's `retrieve.py`. Two sources, one shape:
 *   • a local directory when LP612_PAGE_TRUTH_DIR is set (dev + these tests);
 *   • R2 keys `lp612/page-truth/<bookStem>/<file>.json` otherwise.
 *
 * The invariant worth a test: `pages` are PRINTED page numbers, exactly as they appear at the
 * foot of the book, and a page that is absent is a NAMED failure (PAGE_TRUTH_MISSING) — never
 * a silently short bundle. An LP authored from four of its five pages is an LP with a hole in
 * it that nothing downstream can see.
 *
 * R2 is mocked at the network boundary (the storage module), never the service under test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/storage/r2.js', () => ({
  downloadFromR2: jest.fn(),
}));

const { downloadFromR2 } = require('../../bot/shared/storage/r2.js');
const { fetchPages } = require('../../bot/shared/services/lp612-pagetruth.service');

const BOOK = { title: 'General Science 7', grade: 7, subject: 'science', medium: 'en', language: 'English', offset: 4 };
const TOC = { chapters: [{ number: 1, title: 'Photosynthesis', printed_start: 9 }] };
const page = (n) => ({
  printed_page_number: n,
  pdf_page_index: n + 4,
  page_type: 'content',
  blocks: [{ t: 'prose', text: `page ${n} body` }],
});

let dir;

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-pt-'));
  delete process.env.LP612_PAGE_TRUTH_DIR;
});

afterEach(() => {
  delete process.env.LP612_PAGE_TRUTH_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

function seedLocal(bookStem, pages) {
  const d = path.join(dir, bookStem);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
  fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
  for (const n of pages) {
    fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify(page(n)));
  }
  process.env.LP612_PAGE_TRUTH_DIR = dir;
}

describe('fetchPages — local directory source', () => {
  it('returns the book, the toc and every requested printed page, in order', async () => {
    seedLocal('grade_7_general_science', [11, 12, 13]);

    const out = await fetchPages({ bookStem: 'grade_7_general_science', pages: [11, 12, 13] });

    expect(out.book).toMatchObject({ title: 'General Science 7', grade: 7 });
    expect(out.toc).toMatchObject({ chapters: expect.any(Array) });
    expect(out.pages.map((p) => p.printed_page_number)).toEqual([11, 12, 13]);
    expect(out.pages[0].blocks[0].text).toBe('page 11 body');
  });

  it('reads pages by PRINTED number, zero-padded to three digits', async () => {
    seedLocal('bk', [9]);
    const out = await fetchPages({ bookStem: 'bk', pages: [9] });
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].printed_page_number).toBe(9);
  });

  it('does not touch R2 when the local directory is set', async () => {
    seedLocal('bk', [11]);
    await fetchPages({ bookStem: 'bk', pages: [11] });
    expect(downloadFromR2).not.toHaveBeenCalled();
  });

  it('throws PAGE_TRUTH_MISSING when the book is not in the corpus', async () => {
    seedLocal('bk', [11]);
    await expect(fetchPages({ bookStem: 'no_such_book', pages: [11] }))
      .rejects.toMatchObject({ code: 'PAGE_TRUTH_MISSING' });
  });

  it('throws PAGE_TRUTH_MISSING naming the page when one page of the range is absent', async () => {
    seedLocal('bk', [11, 13]);
    const err = await fetchPages({ bookStem: 'bk', pages: [11, 12, 13] }).catch((e) => e);
    expect(err.code).toBe('PAGE_TRUTH_MISSING');
    expect(err.message).toContain('12');
  });

  it('rejects an empty page list rather than returning an empty bundle', async () => {
    seedLocal('bk', [11]);
    await expect(fetchPages({ bookStem: 'bk', pages: [] }))
      .rejects.toMatchObject({ code: 'PAGE_TRUTH_MISSING' });
  });
});

describe('fetchPages — R2 source', () => {
  const asBuffer = (o) => Buffer.from(JSON.stringify(o), 'utf8');

  it('reads _book, _toc and each page from lp612/page-truth/<bookStem>/', async () => {
    downloadFromR2.mockImplementation(async (key) => {
      if (key.endsWith('/_book.json')) return asBuffer(BOOK);
      if (key.endsWith('/_toc.json')) return asBuffer(TOC);
      const m = /pg_(\d+)\.json$/.exec(key);
      if (m) return asBuffer(page(Number(m[1])));
      const e = new Error('NoSuchKey');
      e.name = 'NoSuchKey';
      throw e;
    });

    const out = await fetchPages({ bookStem: 'grade_9_biology', pages: [21, 22] });

    expect(downloadFromR2).toHaveBeenCalledWith('lp612/page-truth/grade_9_biology/_book.json');
    expect(downloadFromR2).toHaveBeenCalledWith('lp612/page-truth/grade_9_biology/_toc.json');
    expect(downloadFromR2).toHaveBeenCalledWith('lp612/page-truth/grade_9_biology/pg_021.json');
    expect(out.pages.map((p) => p.printed_page_number)).toEqual([21, 22]);
  });

  it('turns an R2 miss on the book into PAGE_TRUTH_MISSING, not a raw S3 error', async () => {
    downloadFromR2.mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
    const err = await fetchPages({ bookStem: 'ghost', pages: [1] }).catch((e) => e);
    expect(err.code).toBe('PAGE_TRUTH_MISSING');
    expect(err.message).toContain('ghost');
  });

  it('turns an R2 miss on ONE page into PAGE_TRUTH_MISSING naming that page', async () => {
    downloadFromR2.mockImplementation(async (key) => {
      if (key.endsWith('/_book.json')) return asBuffer(BOOK);
      if (key.endsWith('/_toc.json')) return asBuffer(TOC);
      if (key.endsWith('pg_007.json')) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      return asBuffer(page(6));
    });
    const err = await fetchPages({ bookStem: 'bk', pages: [6, 7] }).catch((e) => e);
    expect(err.code).toBe('PAGE_TRUTH_MISSING');
    expect(err.message).toContain('7');
  });
});
