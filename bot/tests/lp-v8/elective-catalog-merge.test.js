/**
 * bd-6640j.1.8 — the G1-5 electives join the catalog (TDD, red first).
 *
 * Amena, 9 Oct 2026: "send to sandbox with GK, SST" (with Islamiat G1-5). The
 * uploader and the bot both skip a lesson id that is not in lp_catalog.json, and
 * the 17 core books' segmentation source is not in this repo, so the electives
 * are built on their own and merged in: the core books stay byte-identical.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../../scripts/build-lp-catalog');
const { mergeBooks } = require('../../scripts/lp-catalog-merge');

const book = (stem, grade, subject_key, lessons = 1) => ({
  stem, grade, subject: subject_key, subject_key, rtl: false,
  chapters: [{ number: 1, title: 't', title_short: 't', pages_label: 'p.1',
    lessons: Array.from({ length: lessons }, (_, i) => ({ lesson_id: `${stem}_ch1_seg${i + 1}` })) }],
});
const cat = (books) => ({ catalog_version: 'v8', built_at: 'then', source: { segmentation: '/core' },
  counts: { books: books.length, chapters: books.length, lessons: 0 }, books });

describe('bookMenu — Islamiat', () => {
  test('is an Urdu-medium book read right to left, named in Urdu', () => {
    expect(B.bookMenu({ subject: 'Islamiat', medium: 'ur' }))
      .toEqual({ subject: 'اسلامیات', subject_key: 'islamiat', rtl: true });
  });
  test('without a medium the build fails instead of guessing', () => {
    expect(() => B.bookMenu({ subject: 'Islamiat' })).toThrow(/medium/);
  });
});

describe('mergeBooks — electives into the committed catalog', () => {
  const base = cat([book('grade_1_english', 1, 'english', 3), book('grade_2_math', 2, 'math', 2)]);
  const extra = cat([book('grade_1_islamiat', 1, 'islamiat', 4), book('grade_2_general_knowledge', 2, 'general_knowledge_ur')]);
  extra.source = { segmentation: '/electives' };

  test('the core books come through unchanged', () => {
    const out = mergeBooks(base, extra, { builtAt: 'now' });
    expect(out.books.find((b) => b.stem === 'grade_1_english')).toEqual(base.books[0]);
    expect(out.books.find((b) => b.stem === 'grade_2_math')).toEqual(base.books[1]);
  });

  test('books sort by grade then key, and counts are recounted', () => {
    const out = mergeBooks(base, extra, { builtAt: 'now' });
    expect(out.books.map((b) => b.stem)).toEqual(
      ['grade_1_english', 'grade_1_islamiat', 'grade_2_general_knowledge', 'grade_2_math']);
    expect(out.counts).toEqual({ books: 4, chapters: 4, lessons: 10 });
    expect(out.built_at).toBe('now');
    expect(out.source.segmentation).toBe('/core');
    expect(out.source.merged).toEqual(['/electives']);
  });

  test('a re-merge replaces a book by stem instead of doubling it', () => {
    const once = mergeBooks(base, extra, { builtAt: 'now' });
    const again = mergeBooks(once, { ...cat([book('grade_1_islamiat', 1, 'islamiat', 2)]), source: { segmentation: '/electives' } },
      { builtAt: 'later' });
    expect(again.books.filter((b) => b.stem === 'grade_1_islamiat')).toHaveLength(1);
    expect(again.counts.lessons).toBe(8);
    expect(again.source.merged).toEqual(['/electives']);
  });

  test('a second book on a grade + key already taken is refused (bookFor would hide it)', () => {
    expect(() => mergeBooks(base, cat([book('grade_1_english_v2', 1, 'english')])))
      .toThrow(/grade 1 english/);
  });
});

describe('buildCatalog — an Islamiat book from segmentation', () => {
  test('gets Urdu menu, rtl rows, and tail ids', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isl-'));
    fs.writeFileSync(path.join(dir, 'grade_1_islamiat_full_segments.json'), JSON.stringify({
      _meta: { book_stem: 'grade_1_islamiat', grade: 1, subject: 'Islamiat', medium: 'ur' },
      segments: [
        { chapter_number: 2, segment_index: 1, section: 'ایمانیات', topic: 'توحید کا تعارف', pages_printed: [11] },
        { chapter_number: 2, segment_index: 995, section: 'ایمانیات', topic: 'ورک شیٹ', pages_printed: [11] },
      ],
    }));
    fs.mkdirSync(path.join(dir, 'grade_1_islamiat'));
    fs.writeFileSync(path.join(dir, 'grade_1_islamiat', '_toc.json'),
      JSON.stringify({ book_stem: 'grade_1_islamiat', chapters: [{ number: 2, title: 'ایمانیات و عبادات' }] }));
    const c = B.buildCatalog({ segmentationDir: dir, tocDir: dir, builtAt: 'x', splits: [] });
    const b = c.books[0];
    expect([b.subject, b.subject_key, b.rtl]).toEqual(['اسلامیات', 'islamiat', true]);
    expect(b.chapters[0].title).toBe('ایمانیات و عبادات');
    expect(b.chapters[0].lessons.map((l) => l.lesson_id)).toEqual(['grade_1_islamiat_ch2_seg1', 'grade_1_islamiat_ch2_seg995']);
    expect(b.chapters[0].lessons[0].row.title.startsWith('‏')).toBe(true);
  });
});
