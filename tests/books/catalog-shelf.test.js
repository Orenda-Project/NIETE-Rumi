/**
 * The K-5 catalog serves a teacher her region's BOOKS (bd-97daxo.4/.5, book-first).
 *
 * - A region names its books (region_features.book_keys); null means today's ICT list, which is every
 *   catalog book that is not `opt_in`. GB's NBF books are opt_in: only a region that names them sees them.
 * - A subject whose book is not on her list is HIDDEN. It never falls back to ICT's book (#4091 did,
 *   which showed GB the Urdu-medium GK).
 * - Review chapters (GB English 'R1', GB Urdu 101 'جائزہ-۱') sit where the book puts them and read as
 *   the review they are, not "Ch R1".
 * - ICT menus are byte-identical: the hash below was taken on origin/sandbox 49416a018, before this change.
 */

const Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const { renderAll, hashOf } = require('./menu-snapshot');

const ICT_MENU_HASH_49416a018 = 'cd8d16d26ca46b4aa18353fb7f6f74463b102aa1d41cd31c3637e10d41f6cf53';

const lesson = (id, segmentIndex = 1, title = 'Lesson') => ({
  lesson_id: id, segment_index: segmentIndex, lp_type: 'content', day_label: `Day ${segmentIndex}`, pages_label: 'p.1',
  row: { title, description: `Day ${segmentIndex}`, metadata: 'Topic' },
});
const book = (stem, subjectKey, subject, chapters, extra = {}) => ({
  stem, book_key: stem, grade: 1, subject, subject_key: subjectKey, rtl: false, ...extra, chapters,
});
const ch = (number, title, ids, extra = {}) => ({
  number, title, title_short: title, pages_label: 'p.1-9', ...extra, lessons: ids.map((id, i) => lesson(id, i + 1)),
});

const FAKE = {
  books: [
    book('grade_1_english', 'english', 'English', [ch(1, 'ICT Eng One', ['grade_1_english_ch1_seg1'])]),
    book('grade_1_general_knowledge_en', 'general_knowledge', 'General Knowledge', [ch(1, 'GK EN One', ['grade_1_general_knowledge_en_ch1_seg1'])]),
    book('grade_1_general_knowledge', 'general_knowledge_ur', 'واقفیتِ عامہ', [ch(1, 'GK UR One', ['grade_1_general_knowledge_ch1_seg1'])], { rtl: true }),
    book('grade_1_islamiat', 'islamiat', 'اسلامیات', [ch(1, 'Isl One', ['grade_1_islamiat_ch1_seg1'])], { rtl: true }),
    book('grade_1_maths', 'math', 'Math', [ch(1, 'ICT Maths One', ['grade_1_maths_ch1_seg1'])]),
    book('gb_g1_english', 'english', 'English', [
      ch(1, 'Time to Recall', ['gb_g1_english_ch1_seg1', 'gb_g1_english_ch1_seg2']),
      ch('R1', 'Review 1', ['gb_g1_english_chR1_seg900'], { review: true }),
      ch(2, 'Five Senses', ['gb_g1_english_ch2_seg1']),
    ], { opt_in: true, publisher: 'NBF', language: 'en' }),
    book('gb_g1_maths', 'math', 'Math', [ch(1, 'GB Maths One', ['gb_g1_maths_ch1_seg1'])], { opt_in: true }),
    book('gb_g1_urdu', 'urdu', 'Urdu', [
      ch(1, 'حمد', ['gb_g1_urdu_ch1_seg1']),
      ch(101, 'جائزہ-۱', ['gb_g1_urdu_ch101_seg901'], { review: true }),
    ], { opt_in: true, rtl: true, language: 'ur' }),
  ],
};
const ALL = new Set(FAKE.books.flatMap((b) => b.chapters.flatMap((c) => c.lessons.map((l) => l.lesson_id))));
const GB = ['gb_g1_english', 'gb_g1_urdu', 'gb_g2_science', 'grade_1_general_knowledge_en', 'grade_1_islamiat'];

const ids = (items) => items.map((i) => i.id);
const titles = (items) => items.map((i) => i['main-content'].title);

describe('with a fake catalog holding ICT and GB books', () => {
  beforeAll(() => Catalog.__setCatalogForTests(FAKE));
  afterAll(() => Catalog.__setCatalogForTests(null));

  it('no list (undefined or null) is the ICT list: no opt_in book appears', () => {
    for (const shelf of [[], [null]]) {
      expect(ids(Catalog.buildSubjectItems(1, ALL, ...shelf))).toEqual(
        ['english', 'math', 'general_knowledge_ur', 'general_knowledge', 'islamiat']);
      expect(Catalog.bookFor(1, 'english', ...shelf).stem).toBe('grade_1_english');
      expect(Catalog.bookFor(1, 'urdu', ...shelf)).toBeNull();
      expect(titles(Catalog.buildChapterItems(1, 'english', ALL, ...shelf))).toEqual(['Ch 1 — ICT Eng One']);
    }
    expect(Catalog.shelf(null).map((b) => b.stem)).not.toContain('gb_g1_english');
  });

  it("GB's list: her own English and Urdu, ICT's English GK and Islamiat; no Maths, no Urdu-medium GK", () => {
    expect(ids(Catalog.buildSubjectItems(1, ALL, GB))).toEqual(['english', 'urdu', 'general_knowledge', 'islamiat']);
    expect(Catalog.bookFor(1, 'english', GB).stem).toBe('gb_g1_english');
    expect(Catalog.bookFor(1, 'math', GB)).toBeNull();
    expect(Catalog.bookFor(1, 'general_knowledge_ur', GB)).toBeNull();
    expect(Catalog.subjectTitle(1, 'english', GB)).toBe('English');
    expect(Catalog.buildChapterItems(1, 'math', ALL, GB)).toEqual([]);
    expect(Catalog.gradesWithContent(ALL, GB)).toEqual([1]);
    expect(Catalog.gradesWithContent(new Set(['grade_1_maths_ch1_seg1']), GB)).toEqual([]);
  });

  it('review chapters sit where the book puts them and read as reviews', () => {
    const items = Catalog.buildChapterItems(1, 'english', ALL, GB);
    expect(ids(items)).toEqual(['1', 'R1', '2']);
    expect(titles(items)).toEqual(['Ch 1 — Time to Recall', 'Review 1', 'Ch 2 — Five Senses']);
    expect(Catalog.chapterFor(1, 'english', 'R1', GB).title).toBe('Review 1');
    const lessons = Catalog.buildLessonItems(1, 'english', 'R1', ALL, new Set(), 1, GB);
    expect(lessons.items.map((i) => i.id)).toEqual(['V8-gb_g1_english_chR1_seg900']);

    const urdu = Catalog.buildChapterItems(1, 'urdu', ALL, GB);
    expect(ids(urdu)).toEqual(['1', '101']);
    expect(titles(urdu)[1]).toBe('‏جائزہ-۱');
  });

  it('a numeric chapter still answers to a number or a string, as before', () => {
    expect(Catalog.chapterFor(1, 'english', 1).title).toBe('ICT Eng One');
    expect(Catalog.chapterFor(1, 'english', '1').title).toBe('ICT Eng One');
    expect(Catalog.chapterFor(1, 'urdu', '101', GB).title).toBe('جائزہ-۱');
  });

  it('lessonById finds a GB lesson whatever the list (delivery is by id)', () => {
    expect(Catalog.lessonById('gb_g1_english_chR1_seg900').book.stem).toBe('gb_g1_english');
  });
});

describe('the real catalog', () => {
  it("an ICT teacher's menus are byte-identical to origin/sandbox 49416a018", () => {
    expect(hashOf(renderAll(Catalog))).toBe(ICT_MENU_HASH_49416a018);
    expect(hashOf(renderAll(Catalog, null))).toBe(ICT_MENU_HASH_49416a018);
  });

  it('every book carries book_key (= stem), publisher and language; only GB books are opt_in', () => {
    for (const b of Catalog.catalog().books) {
      expect(b.book_key).toBe(b.stem);
      expect(['en', 'ur']).toContain(b.language);
      expect(b).toHaveProperty('publisher');
      expect(Boolean(b.opt_in)).toBe(b.stem.startsWith('gb_'));
    }
  });
});
