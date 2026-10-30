/**
 * Grades 6-12 lesson plans: the teacher's curriculum segments, else ICT's (bd-97daxo.5).
 *
 * niete_lp612_segments carries `curriculum` (V1.8.6, default 'ict'). A GB book is loaded as rows
 * tagged 'nbf_snc' under their own book_stem. From then on a GB teacher gets GB's segments for that
 * grade and subject, ICT's for every other; an ICT teacher's menus are exactly today's — the GB
 * rows never leak into them. Both readers are covered: the portal's browse and the WhatsApp menu.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const { createMemorySupabase } = require('../fixtures/memory-supabase');
  return createMemorySupabase({});
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const db = require('../../bot/shared/config/supabase');
const Browse = require('../../bot/shared/services/lp612-browse.service');
const Catalog = require('../../bot/shared/services/lp612-catalog.service');

let n = 0;
const seg = (curriculum, bookStem, subject, chapterKey, chapterNumber, chapterTitle, grade = 9) => {
  n += 1;
  return {
    segment_id: `${bookStem}.${chapterKey}.s${n}`, curriculum, book_stem: bookStem, grade, also_grades: [],
    subject, language: 'en', chapter_key: chapterKey, chapter_number: chapterNumber, chapter_title: chapterTitle,
    subtopic_title: `${chapterTitle} topic ${n}`, menu_title: `${chapterTitle} ${n}`, printed_page_start: n,
    printed_page_end: n, order_index: n, lp_type: 'content', is_current: true, is_religious: false, yt: null, part: null,
  };
};

const ICT = [
  seg('ict', 'grade_9_chemistry', 'Chemistry', 'c01', 1, 'ICT Chem One'),
  seg('ict', 'grade_9_chemistry', 'Chemistry', 'c01', 1, 'ICT Chem One'),
  seg('ict', 'grade_9_chemistry', 'Chemistry', 'c02', 2, 'ICT Chem Two'),
  seg('ict', 'grade_9_physics', 'Physics', 'c01', 1, 'ICT Physics One'),
];
const GB = [
  seg('nbf_snc', 'nbf_snc_grade_9_chemistry', 'Chemistry', 'c01', 1, 'GB Chem One'),
  // A grade ICT holds nothing for.
  seg('nbf_snc', 'nbf_snc_grade_6_english', 'English', 'c01', 1, 'GB G6 English', 6),
];

const seed = (rows) => db.reset({ niete_lp612_segments: rows, niete_lp612_renders: [] });
const titles = (items) => items.map((r) => `${r['main-content'].title} ${r['main-content'].metadata || ''}`).join(' | ');

describe('the portal browse (lp612-browse)', () => {
  async function everything(...opts) {
    return {
      grades: await Browse.listGrades(...opts),
      subjects: await Browse.listSubjects(9, ...opts),
      chapters: await Browse.listChapters(9, 'Chemistry', ...opts),
      lessons: await Browse.listLessons(9, 'Chemistry', 'c01', 'en', null, ...opts),
    };
  }

  it("an ICT teacher sees exactly today's lists, with or without GB rows in the table", async () => {
    seed(ICT);
    const today = await everything();
    // In the menu's own core-before-elective order (lp612-subject-order): Physics, then Chemistry.
    expect(today.subjects).toEqual([{ subject: 'Physics', lesson_count: 1 }, { subject: 'Chemistry', lesson_count: 3 }]);

    seed([...ICT, ...GB]);
    expect(await everything()).toEqual(today);
    expect(await everything({ curriculum: 'ict' })).toEqual(today);
  });

  it("a GB teacher gets GB's Chemistry and ICT's Physics, and GB's extra grade", async () => {
    seed([...ICT, ...GB]);
    const gb = { curriculum: 'nbf_snc' };
    expect((await Browse.listGrades(gb)).map((g) => g.grade)).toEqual([6, 9]);
    expect(await Browse.listSubjects(9, gb)).toEqual([{ subject: 'Physics', lesson_count: 1 }, { subject: 'Chemistry', lesson_count: 1 }]);
    expect((await Browse.listChapters(9, 'Chemistry', gb)).map((c) => c.chapter_title)).toEqual(['GB Chem One']);
    expect((await Browse.listChapters(9, 'Physics', gb)).map((c) => c.chapter_title)).toEqual(['ICT Physics One']);
    expect((await Browse.listLessons(9, 'Chemistry', 'c01', 'en', null, gb)).map((l) => l.segment_id))
      .toEqual([GB[0].segment_id]);
  });

  it('a GB teacher gets ICT exactly while no GB segments are loaded', async () => {
    seed(ICT);
    const ict = await everything();
    expect(await everything({ curriculum: 'nbf_snc' })).toEqual(ict);
  });
});

describe('the WhatsApp menu (lp612-catalog)', () => {
  // The fake ignores `.or()` (the grade / also_grades filter), so this block holds one grade only.
  const GB9 = GB.filter((r) => r.grade === 9);
  async function menus(...opts) {
    return {
      subjects: await Catalog.buildSubjectItems(9, ...opts),
      chapters: (await Catalog.buildChapterItems(9, 'Chemistry', 1, ...opts)).items,
      segments: (await Catalog.buildSegmentItems(9, 'Chemistry', 'c01', 1, null, ...opts)).items,
    };
  }

  it("an ICT teacher's rows are exactly today's, with or without GB rows in the table", async () => {
    seed(ICT);
    const today = await menus();
    expect(titles(today.chapters)).toContain('ICT Chem One');

    seed([...ICT, ...GB9]);
    expect(await menus()).toEqual(today);
    expect(await menus({ curriculum: 'ict' })).toEqual(today);
  });

  it("a GB teacher's Chemistry is GB's book; Physics stays ICT's", async () => {
    seed([...ICT, ...GB9]);
    const gb = { curriculum: 'nbf_snc' };
    const m = await menus(gb);
    expect(titles(m.chapters)).toContain('GB Chem One');
    expect(titles(m.chapters)).not.toContain('ICT Chem');
    expect(m.segments.map((r) => r.id)).toEqual([GB[0].segment_id]);
    const subjects = await Catalog.buildSubjectItems(9, gb);
    expect(subjects.map((r) => [r.id, r['main-content'].metadata])).toEqual([
      ['Physics', 'Grade 9 · 1 lesson'], ['Chemistry', 'Grade 9 · 1 lesson'],
    ]);
  });
});
