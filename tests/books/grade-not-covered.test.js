/**
 * A region's book list also says which GRADES it has books for (bd-97daxo.4, operator 6 Nov).
 *
 * A grade her list does not cover gets no lesson plans, no question papers and no book features, and she is TOLD
 * so, politely, in her language, instead of an error. (GB's live list now runs to Grade 10 with ICT's 6-10 books,
 * bd-qchgya; the fixtures below use a short GB list on purpose.) A teacher whose region names no books (every ICT teacher) is unchanged.
 */
const TeacherBooks = require('../../bot/shared/services/teacher-books.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const GB = ['gb_g1_english', 'gb_g2_urdu', 'grade_1_islamiat', 'grade_5_islamiat'];

describe('gradeCovered', () => {
  test('no list covers every grade; a list covers only the grades of its books', () => {
    for (const g of [1, 5, 6, 7, 12]) expect(TeacherBooks.gradeCovered(g, null)).toBe(true);
    expect(TeacherBooks.gradeCovered(1, GB)).toBe(true);
    expect(TeacherBooks.gradeCovered(2, GB)).toBe(true);
    expect(TeacherBooks.gradeCovered(5, GB)).toBe(true);
    for (const g of [3, 6, 7, 9, 12]) expect(TeacherBooks.gradeCovered(g, GB)).toBe(false);
    expect(TeacherBooks.gradeCovered(7, ['grade_7_english'])).toBe(true);
    expect(TeacherBooks.gradeCovered(7, [])).toBe(false);
    // ICT's 6-12 book stems come in two shapes (grade_9_biology, g7_physics); both name their grade (bd-qchgya).
    expect(TeacherBooks.gradeCovered(7, ['g7_physics'])).toBe(true);
    expect(TeacherBooks.gradeCovered(10, ['g10_english'])).toBe(true);
    expect(TeacherBooks.gradeCovered(1, ['g10_english'])).toBe(false);
  });

  test('the two messages, English and Urdu (Urdu digits in Urdu prose)', () => {
    expect(TeacherBooks.gradeNotCoveredMessage('lp', 7, 'en'))
      .toBe("Lesson plans for Grade 7 aren't available for your school yet. We'll add them as soon as they're ready.");
    expect(TeacherBooks.gradeNotCoveredMessage('exam', 7, 'en'))
      .toBe("Question papers for Grade 7 aren't available for your school yet. We'll add them as soon as they're ready.");
    const ur = TeacherBooks.gradeNotCoveredMessage('lp', 7, 'ur');
    expect(ur).toContain('۷');
    expect(ur).not.toMatch(/[0-9]/);
    expect(ur).toContain('سبق کے منصوبے');
    expect(TeacherBooks.gradeNotCoveredMessage('exam', 12, 'ur')).toContain('۱۲');
    expect(resolveUx('examGradeNotForRegionBooks', { language: 'ur', params: { grade: '۸' } })).toContain('سوالیہ پرچے');
  });
});

describe('the WhatsApp lesson-plan Flow', () => {
  let ep;
  let db;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../bot/shared/config/supabase', () => {
      const { createMemorySupabase } = require('../fixtures/memory-supabase');
      return createMemorySupabase({});
    });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocumentByLink: jest.fn() }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ buildR2PublicUrl: (k) => k, getPresignedUrl: async (u) => u }));
    jest.doMock('../../bot/shared/services/oxbridge-lp.service', () => ({ gradeWord: () => null, isEligibleGrade: () => false }));
    jest.doMock('../../bot/shared/services/lp612-serving.service', () => ({}));
    jest.doMock('../../bot/shared/services/lp-v8-delivery.service', () => ({
      availableLessonIds: async () => new Set(), downloadedLessonIds: async () => new Set(),
    }));
    db = require('../../bot/shared/config/supabase');
    db.reset({
      users: [
        { id: 'gb-en', region: 'Gilgit-Baltistan', preferred_language: 'en' },
        { id: 'gb-ur', region: 'Gilgit-Baltistan', preferred_language: 'ur' },
        { id: 'ict', region: 'Sihala', preferred_language: 'en' },
      ],
      region_features: [
        { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', book_keys: GB },
        { region: 'sihala', organization: 'niete', display_name: 'Sihala', book_keys: null },
      ],
    });
    ep = require('../../bot/shared/routes/pakistan-lp-endpoint');
  });

  const pick = (user, grade) => ep.handlePakistanLpDataExchange(`${user}:pakistan-lp:1`, 'SELECT_GRADE', { step: 'grade', grade: String(grade) });

  test('a GB teacher who picks Grade 7 is told, in English or Urdu, that it is not available yet', async () => {
    expect((await pick('gb-en', 7)).data.error.message).toBe(TeacherBooks.gradeNotCoveredMessage('lp', 7, 'en'));
    expect((await pick('gb-ur', 7)).data.error.message).toBe(TeacherBooks.gradeNotCoveredMessage('lp', 7, 'ur'));
    expect((await pick('gb-en', 3)).data.error.message).toBe(TeacherBooks.gradeNotCoveredMessage('lp', 3, 'en'));
  });

  test('an ICT teacher picking Grade 7 never sees that message', async () => {
    const res = await pick('ict', 7);
    expect(JSON.stringify(res)).not.toContain("aren't available for your school");
  });
});

describe('the WhatsApp question-paper Flow', () => {
  let Flow;
  beforeEach(() => {
    jest.resetModules();
    const H = require('../assessment/helpers/golden-g1-5');
    const state = { rows: {}, seq: 0, updates: [], settings: {}, tables: { textbooks: [] }, queued: [], redis: new Map() };
    for (const g of [1, 7]) state.tables.textbooks.push({ id: `b-${g}`, curriculum: 'ict', grade: g, subject: 'english', total_pages: 9 });
    state.tables.textbooks.push({ id: 'b-1i', curriculum: 'ict', grade: 1, subject: 'islamiat', total_pages: 9 });
    state.tables.users = [
      { id: 'gb-ur', region: 'Gilgit-Baltistan', preferred_language: 'ur' },
      { id: 'gb-610', region: 'Gilgit-Baltistan', preferred_language: 'en' },
    ];
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => H.fakeDb(state));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      get: async (k) => (state.redis.has(k) ? JSON.parse(state.redis.get(k)) : null),
      set: async (k, v) => { state.redis.set(k, JSON.stringify(v)); return true; },
      setNX: async () => true, delete: async () => true,
    }));
    jest.doMock('../../bot/shared/config/feature-flags', () => ({
      ...jest.requireActual('../../bot/shared/config/feature-flags'),
      GradeGateSettings: { load: async () => ({ flag: true, kill: [], killCells: [] }) },
    }));
    jest.doMock('../../bot/shared/services/teacher-books.service', () => ({
      ...jest.requireActual('../../bot/shared/services/teacher-books.service'),
      bookKeysForUser: jest.fn(async (id) => (id === 'gb-610' ? [...GB, 'grade_7_english'] : id.startsWith('gb') ? GB : null)),
    }));
    Flow = require('../../bot/shared/routes/assessment-gen-endpoint');
  });

  test('a GB teacher who picks Grade 7 gets no subjects and the not-available message in her language', async () => {
    const res = await Flow.handleAssessmentGenDataExchange('gb-ur', 'CLASS', { grade: '7', trigger: 'grade_selected' }, 'tok-gb');
    expect(res.data.subjects).toEqual([]);
    expect(res.data.error).toBe(TeacherBooks.gradeNotCoveredMessage('exam', 7, 'ur'));
  });

  // bd-qchgya — once her list names ICT's Grade 7 book, Grade 7 question papers open with lesson plans.
  test('a GB teacher whose list covers Grade 7 is offered its subjects, with no message', async () => {
    const res = await Flow.handleAssessmentGenDataExchange('gb-610', 'CLASS', { grade: '7', trigger: 'grade_selected' }, 'tok-gb7');
    expect(res.data.subjects.map((s) => s.id)).toEqual(['english']);
    expect(res.data.error || '').toBe('');
  });
});
