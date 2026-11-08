/**
 * The portal's lesson menu and assessment form follow the teacher's books (bd-97daxo.4).
 *
 * The portal forwards its SESSION's teacher as body.userId. The bot turns her into her region's book
 * list and hands it to the browse service; no userId (an older portal build) is today's call exactly.
 *
 * Assessments are keyed by book: the generator reads ICT's books (English, Urdu, Maths, Science and the
 * Urdu-medium GK and Social Studies), so a GB teacher is offered a G1-5 subject only where that ICT
 * book is on her list — Islamiat — or her own NBF book is on her list AND loaded (bd-6nskfq.1, below).
 */
const KEY = 'book-shelf-key';
const GB_KEYS = ['gb_g1_english', 'gb_g1_urdu', 'gb_g1_maths', 'grade_1_general_knowledge_en', 'grade_1_islamiat'];
let router;
let Browse;
let AssessmentBrowse;

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

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
  jest.doMock('../../bot/shared/config/feature-flags', () => ({
    ...jest.requireActual('../../bot/shared/config/feature-flags'),
    isAssessmentTopicCtaEnabled: jest.fn(async () => false),
    isAssessmentFdePatternEnabled: jest.fn(async () => false),
  }));
  jest.doMock('../../bot/shared/services/teacher-books.service', () => ({
    ...jest.requireActual('../../bot/shared/services/teacher-books.service'),
    bookKeysForUser: jest.fn(async (id) => (id === 'gb-teacher' ? GB_KEYS : null)),
  }));
  jest.doMock('../../bot/shared/services/lp-v8-browse.service', () => ({
    listGrades: jest.fn(async () => [{ grade: 1, subject_count: 2 }]),
    listSubjects: jest.fn(async () => []),
    listChapters: jest.fn(async () => []),
    listLessons: jest.fn(async () => []),
  }));
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    listGrades: jest.fn(async () => [1, 2, 3, 4, 5]),
    listSubjects: jest.fn(async () => ['english', 'urdu', 'maths', 'general_knowledge', 'islamiat']
      .map((s) => ({ subject_key: s, subject: s }))),
    questionOptions: () => ({ types: [], maxQuestions: 50, defaultQuestions: 15 }),
    bookFor: jest.fn(async () => ({ id: 'book-1', total_pages: 100 })),
    listChapters: jest.fn(async () => [{ chapter_number: 1, chapter_title: 'One', page_start: 1, page_end: 9 }]),
  }));
  jest.doMock('../../bot/shared/services/lp612-browse.service', () => ({
    listGrades: jest.fn(async () => [{ grade: 6 }, { grade: 7 }]),
    listSubjects: jest.fn(async () => [{ subject: 'English' }]),
    listChapters: jest.fn(async () => []),
    listLessons: jest.fn(async () => []),
  }));
  router = require('../../bot/shared/routes/internal-api.routes');
  Browse = require('../../bot/shared/services/lp-v8-browse.service');
  AssessmentBrowse = require('../../bot/shared/services/assessment/assessment-browse.service');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('lesson menu', () => {
  test("a GB teacher's portal call carries her book list to every browse step", async () => {
    await invoke('/lp/v8/grades', { userId: 'gb-teacher' });
    await invoke('/lp/v8/subjects', { userId: 'gb-teacher', grade: 1 });
    await invoke('/lp/v8/chapters', { userId: 'gb-teacher', grade: 1, subjectKey: 'english' });
    await invoke('/lp/v8/lessons', { userId: 'gb-teacher', grade: 1, subjectKey: 'english', chapterNumber: 1 });
    expect(Browse.listGrades).toHaveBeenLastCalledWith(GB_KEYS);
    expect(Browse.listSubjects).toHaveBeenLastCalledWith(1, GB_KEYS);
    expect(Browse.listChapters).toHaveBeenLastCalledWith(1, 'english', GB_KEYS);
    expect(Browse.listLessons).toHaveBeenLastCalledWith(1, 'english', 1, 'gb-teacher', GB_KEYS);
  });

  test('an ICT teacher, or no userId, is the call it always was', async () => {
    for (const body of [{ userId: 'sector-teacher' }, {}]) {
      await invoke('/lp/v8/subjects', { ...body, grade: 1 });
      expect(Browse.listSubjects).toHaveBeenLastCalledWith(1);
      await invoke('/lp/v8/chapters', { ...body, grade: 1, subjectKey: 'english' });
      expect(Browse.listChapters).toHaveBeenLastCalledWith(1, 'english');
    }
    await invoke('/lp/v8/grades', {});
    expect(Browse.listGrades).toHaveBeenLastCalledWith();
  });

  test('a review chapter (R1) is a chapter the lessons route accepts', async () => {
    const { statusCode } = await invoke('/lp/v8/lessons', { userId: 'gb-teacher', grade: 1, subjectKey: 'english', chapterNumber: 'R1' });
    expect(statusCode).toBe(200);
    expect(Browse.listLessons).toHaveBeenLastCalledWith(1, 'english', 'R1', 'gb-teacher', GB_KEYS);
    const bad = await invoke('/lp/v8/lessons', { grade: 1, subjectKey: 'english', chapterNumber: 'x; drop' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('assessments', () => {
  test('G1-5: a GB teacher is offered only the subjects whose ICT book is on her list', async () => {
    const { payload } = await invoke('/assessment/options', { userId: 'gb-teacher', grade: 1 });
    expect(payload.subjects.map((s) => s.subject_key)).toEqual(['islamiat']);
  });

  test('an ICT teacher keeps every subject', async () => {
    const { payload } = await invoke('/assessment/options', { userId: 'sector-teacher', grade: 1 });
    expect(payload.subjects.map((s) => s.subject_key)).toEqual(['english', 'urdu', 'maths', 'general_knowledge', 'islamiat']);
  });

  test("a GB teacher's English (an NBF book, no assessment content) is refused, Islamiat is not", async () => {
    const eng = await invoke('/assessment/chapters', { userId: 'gb-teacher', grade: 1, subject: 'english' });
    expect(eng.statusCode).toBe(400);
    const isl = await invoke('/assessment/chapters', { userId: 'gb-teacher', grade: 1, subject: 'islamiat' });
    expect(isl.statusCode).toBe(200);
    expect(AssessmentBrowse.listChapters).toHaveBeenCalledWith(1, 'islamiat');
  });
});

describe('assessments: her own books, once loaded (bd-6nskfq.1)', () => {
  const nbfLoaded = new Set(['1:english', '1:maths', '5:maths']);
  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = KEY;
    jest.doMock('../../bot/shared/services/book-curriculum.service', () => ({
      ...jest.requireActual('../../bot/shared/services/book-curriculum.service'),
      curriculumForUser: jest.fn(async (id) => (id === 'gb-teacher' ? 'nbf_snc' : 'ict')),
      hasTextbook: jest.fn(async (c, g, s) => c === 'nbf_snc' && nbfLoaded.has(`${g}:${s}`)),
    }));
    router = require('../../bot/shared/routes/internal-api.routes');
    AssessmentBrowse = require('../../bot/shared/services/assessment/assessment-browse.service');
  });

  test('the portal offers a GB teacher her loaded own books and Islamiat, not her unloaded Urdu', async () => {
    const { payload } = await invoke('/assessment/options', { userId: 'gb-teacher', grade: 1 });
    expect(payload.subjects.map((s) => s.subject_key)).toEqual(['english', 'maths', 'islamiat']);
  });

  test('her English chapters are served; her unloaded Urdu is refused', async () => {
    expect((await invoke('/assessment/chapters', { userId: 'gb-teacher', grade: 1, subject: 'english' })).statusCode).toBe(200);
    expect((await invoke('/assessment/chapters', { userId: 'gb-teacher', grade: 1, subject: 'urdu' })).statusCode).toBe(400);
  });

  test('an ICT teacher keeps every subject', async () => {
    const { payload } = await invoke('/assessment/options', { userId: 'sector-teacher', grade: 1 });
    expect(payload.subjects.map((s) => s.subject_key)).toEqual(['english', 'urdu', 'maths', 'general_knowledge', 'islamiat']);
  });

  // FDE pattern papers are built from ICT's books under an "FDE pattern" header; GB has no pattern design yet, so
  // her own NBF books never open one (design pending). Her plain paper on the same book is offered (above).
  test('no FDE pattern paper is offered or made on her own NBF book', async () => {
    const Flags = require('../../bot/shared/config/feature-flags');
    Flags.isAssessmentFdePatternEnabled.mockResolvedValue(true);
    Flags.fdePatternSubjects = jest.fn(async () => null);
    require('../../bot/shared/services/teacher-books.service').bookKeysForUser
      .mockImplementation(async (id) => (id === 'gb-teacher' ? ['gb_g5_maths', 'grade_5_islamiat'] : null));
    const gb = await invoke('/assessment/options', { userId: 'gb-teacher', grade: 5, subject: 'maths' });
    expect(gb.payload.subjects.map((s) => s.subject_key)).toContain('maths'); // her plain paper: offered
    expect(gb.payload.patterns).toBeUndefined();
    const made = await invoke('/assessment/create', { userId: 'gb-teacher', grade: 5, subject: 'maths', pattern: 'fde_g5_2027' });
    expect(made.statusCode).toBe(400);
    expect(made.payload.errorCode).toBe('NOT_ELIGIBLE');
    const ict = await invoke('/assessment/options', { userId: 'sector-teacher', grade: 5, subject: 'maths' });
    expect(ict.payload.patterns.map((x) => x.id)).toEqual(['fde_g5_2027']);
  });
});

describe('Grade 6+ for a region whose books stop at Grade 5 (operator, 6 Nov)', () => {
  test('the portal offers a GB teacher only the grades her books cover; an ICT teacher keeps them all', async () => {
    AssessmentBrowse.listGrades.mockResolvedValue([1, 2, 5, 6, 7]);
    const gb = await invoke('/assessment/options', { userId: 'gb-teacher' });
    expect(gb.payload.grades).toEqual([1]);
    const ict = await invoke('/assessment/options', { userId: 'sector-teacher' });
    expect(ict.payload.grades).toEqual([1, 2, 5]); // the G6-12 grade gate is off in this file, as before
  });

  test('a GB Grade 7 paper is refused at the door; the portal 6-12 lesson lists are empty for her', async () => {
    const chapters = await invoke('/assessment/chapters', { userId: 'gb-teacher', grade: 7, subject: 'english' });
    expect(chapters.statusCode).toBe(400);
    const Lp612 = require('../../bot/shared/services/lp612-browse.service');
    const grades = await invoke('/lp612/grades', { userId: 'gb-teacher' });
    expect(grades.payload.grades).toEqual([]);
    const subjects = await invoke('/lp612/subjects', { userId: 'gb-teacher', grade: 7 });
    expect(subjects.payload.subjects).toEqual([]);
    expect(Lp612.listSubjects).not.toHaveBeenCalled();
    await invoke('/lp612/grades', { userId: 'sector-teacher' });
    expect(Lp612.listGrades).toHaveBeenCalled();
  });
});
