/**
 * Grades 1-5 lesson plans: the teacher's curriculum book, else ICT's (bd-97daxo.5).
 *
 * A book entry in lp_catalog.json may carry `curriculum` (absent = 'ict'). A GB book is added as
 * data — an entry tagged 'nbf_snc' whose stem, and so every lesson id, starts `nbf_snc_` — and from then on a
 * GB teacher gets it for that grade and subject while an ICT teacher's menus stay byte-identical.
 * A GB book with nothing uploaded yet is not a book she can use: she keeps ICT's until it has one.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Catalog = require('../../bot/shared/services/lp-v8-catalog.service');

const lesson = (id, seg = 1) => ({
  lesson_id: id, segment_index: seg, lp_type: 'content', day_label: `Day ${seg}`, section: 'S', section_short: 'S',
  topic: 'T', topic_short: 'T', pages: [1], pages_label: 'p.1',
  row: { title: `Lesson ${id}`.slice(0, 28), description: 'Day 1 · p.1', metadata: 'T' },
});
const book = (stem, grade, subjectKey, subject, chapters, extra = {}) => ({
  stem, grade, subject, subject_key: subjectKey, rtl: false, ...extra,
  chapters: chapters.map(([number, title, ids]) => ({ number, title, title_short: title, pages_label: 'p.1-9', lessons: ids.map((id, i) => lesson(id, i + 1)) })),
});

const ICT = [
  book('grade_3_english', 3, 'english', 'English', [[1, 'ICT Eng One', ['grade_3_english_ch1_seg1', 'grade_3_english_ch1_seg2']], [2, 'ICT Eng Two', ['grade_3_english_ch2_seg1']]]),
  book('grade_3_math', 3, 'math', 'Mathematics', [[1, 'ICT Maths One', ['grade_3_math_ch1_seg1']]]),
];
const GB = [
  book('nbf_snc_grade_3_english', 3, 'english', 'English', [[1, 'GB Eng One', ['nbf_snc_grade_3_english_ch1_seg1']]], { curriculum: 'nbf_snc' }),
  // A grade ICT holds nothing for.
  book('nbf_snc_grade_2_english', 2, 'english', 'English', [[1, 'GB G2 One', ['nbf_snc_grade_2_english_ch1_seg1']]], { curriculum: 'nbf_snc' }),
];
const catalogOf = (books) => ({ catalog_version: 'v8', books });
const all = (books) => new Set(books.flatMap((b) => b.chapters.flatMap((c) => c.lessons.map((l) => l.lesson_id))));

afterAll(() => Catalog.__setCatalogForTests(null));

/** Every menu an ICT teacher can draw, in one object. */
function menus(available, ...curriculum) {
  return {
    grades: Catalog.gradesWithContent(available, ...curriculum),
    subjects: Catalog.buildSubjectItems(3, available, ...curriculum),
    chapters: Catalog.buildChapterItems(3, 'english', available, ...curriculum),
    lessons: Catalog.buildLessonItems(3, 'english', 1, available, new Set(), 1, ...curriculum),
    book: Catalog.bookFor(3, 'english', ...curriculum),
    title: Catalog.subjectTitle(3, 'english', ...curriculum),
    chapter: Catalog.chapterFor(3, 'english', 1, ...curriculum),
  };
}

describe('an ICT teacher', () => {
  it('draws exactly today\'s menus, with or without a GB book in the catalog', () => {
    Catalog.__setCatalogForTests(catalogOf(ICT));
    const today = menus(all(ICT));
    expect(today.chapters.map((r) => r['main-content'].title).join(' ')).toContain('ICT Eng One');

    Catalog.__setCatalogForTests(catalogOf([...ICT, ...GB]));
    const both = all([...ICT, ...GB]);
    expect(menus(both)).toEqual(today);
    expect(menus(both, 'ict')).toEqual(today);
  });
});

describe('a GB teacher', () => {
  beforeEach(() => Catalog.__setCatalogForTests(catalogOf([...ICT, ...GB])));

  it("gets GB's book where GB has one with lessons up, ICT's for every other subject", () => {
    const available = all([...ICT, ...GB]);
    expect(Catalog.bookFor(3, 'english', 'nbf_snc', available).stem).toBe('nbf_snc_grade_3_english');
    expect(Catalog.bookFor(3, 'math', 'nbf_snc', available).stem).toBe('grade_3_math');
    expect(Catalog.gradesWithContent(available, 'nbf_snc')).toEqual([2, 3]);

    const subjects = Catalog.buildSubjectItems(3, available, 'nbf_snc');
    expect(subjects.map((r) => r.id)).toEqual(['english', 'math']);
    expect(subjects[0]['main-content'].metadata).toMatch(/1 lesson ready/);

    const chapters = Catalog.buildChapterItems(3, 'english', available, 'nbf_snc');
    expect(chapters.map((r) => r['main-content'].title).join(' ')).toContain('GB Eng One');
    expect(chapters.map((r) => r['main-content'].title).join(' ')).not.toContain('ICT');

    const { items } = Catalog.buildLessonItems(3, 'english', 1, available, new Set(), 1, 'nbf_snc');
    expect(items.map((r) => r.id)).toEqual(['V8-nbf_snc_grade_3_english_ch1_seg1']);
  });

  it("keeps ICT's book while GB's has nothing uploaded", () => {
    const icOnly = all(ICT);
    expect(Catalog.bookFor(3, 'english', 'nbf_snc', icOnly).stem).toBe('grade_3_english');
    expect(Catalog.buildChapterItems(3, 'english', icOnly, 'nbf_snc').map((r) => r['main-content'].title).join(' ')).toContain('ICT Eng One');
    expect(Catalog.gradesWithContent(icOnly, 'nbf_snc')).toEqual([3]);
  });

  it('a GB lesson id is still found by id (delivery, opens, downloads key on it)', () => {
    expect(Catalog.lessonById('nbf_snc_grade_3_english_ch1_seg1').book.curriculum).toBe('nbf_snc');
  });
});

describe('the portal browse (lp-v8-browse) takes the same curriculum', () => {
  jest.doMock('../../bot/shared/services/lp-v8-delivery.service', () => ({
    availableLessonIds: async () => all([...ICT, ...GB]),
    downloadedLessonIds: async () => new Set(),
  }));
  jest.doMock('../../bot/shared/services/lp-ab-ch310.service', () => ({
    groupFor: async () => 'A', augustListable: async () => null,
  }));
  const Browse = require('../../bot/shared/services/lp-v8-browse.service');

  it('ICT: GB never appears; GB: its book for English, ICT for Maths', async () => {
    Catalog.__setCatalogForTests(catalogOf([...ICT, ...GB]));
    expect((await Browse.listGrades()).map((g) => g.grade)).toEqual([3]);
    expect((await Browse.listChapters(3, 'english')).map((c) => c.chapter_title)).toEqual(['ICT Eng One', 'ICT Eng Two']);
    expect((await Browse.listGrades({ curriculum: 'nbf_snc' })).map((g) => g.grade)).toEqual([2, 3]);
    expect((await Browse.listSubjects(3, { curriculum: 'nbf_snc' })).map((s) => s.lesson_count)).toEqual([1, 1]);
    expect((await Browse.listChapters(3, 'english', { curriculum: 'nbf_snc' })).map((c) => c.chapter_title)).toEqual(['GB Eng One']);
    expect((await Browse.listLessons(3, 'english', 1, null, { curriculum: 'nbf_snc' })).map((l) => l.lesson_id))
      .toEqual(['nbf_snc_grade_3_english_ch1_seg1']);
  });
});

describe('build-lp-catalog writes the tag, and refuses a non-ICT stem that could collide', () => {
  const Build = require('../../bot/scripts/build-lp-catalog');

  function tree(books) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-cat-'));
    const seg = path.join(root, 'seg');
    const toc = path.join(root, 'toc');
    fs.mkdirSync(seg);
    fs.mkdirSync(toc);
    for (const b of books) {
      fs.writeFileSync(path.join(seg, `${b.stem}_full_segments.json`), JSON.stringify({
        _meta: { book_stem: b.stem, grade: 3, subject: 'English', ...(b.curriculum ? { curriculum: b.curriculum } : {}) },
        segments: [{ chapter_number: 1, segment_index: 1, section: 'Warm up', topic: 'Greetings', pages_printed: [2] }],
      }));
      fs.mkdirSync(path.join(toc, b.stem));
      fs.writeFileSync(path.join(toc, b.stem, '_toc.json'), JSON.stringify({ book_stem: b.stem, chapters: [{ number: 1, title: 'One' }] }));
    }
    return { segmentationDir: seg, tocDir: toc };
  }

  it('an ICT book carries no curriculum key (the committed catalog stays byte-identical); a GB one does', () => {
    const cat = Build.buildCatalog({ ...tree([{ stem: 'grade_3_english' }, { stem: 'nbf_snc_grade_3_english', curriculum: 'nbf_snc' }]), builtAt: 'x', splits: [] });
    const ict = cat.books.find((b) => b.stem === 'grade_3_english');
    const gb = cat.books.find((b) => b.stem === 'nbf_snc_grade_3_english');
    expect(Object.keys(ict)).not.toContain('curriculum');
    expect(gb.curriculum).toBe('nbf_snc');
    expect(gb.chapters[0].lessons[0].lesson_id).toBe('nbf_snc_grade_3_english_ch1_seg1');
  });

  it('a non-ICT book whose stem does not start with its curriculum is refused', () => {
    expect(() => Build.buildCatalog({ ...tree([{ stem: 'grade_3_english', curriculum: 'nbf_snc' }]), builtAt: 'x', splits: [] }))
      .toThrow(/nbf_snc_/);
  });
});
