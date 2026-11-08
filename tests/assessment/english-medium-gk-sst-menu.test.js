/**
 * bd-uam6dh.1 — General Knowledge and Social Studies each come in two books: Urdu-medium and
 * English-medium. A teacher picks the book she teaches from and gets that book's paper (Amena,
 * 8 Nov: "if its the english medium one, they should get that paper not the urdu-medium, and
 * vice versa"). The English books are their own subject codes, general_knowledge_en and
 * social_studies_en, so the menu can offer both side by side.
 *
 * GB's shelf holds only the English books, so a GB teacher sees English GK/SST and never the Urdu
 * ones. ICT has no shelf, so an ICT teacher sees both, each labelled with its medium. A grade that
 * holds one book only keeps the plain name it has today.
 */

const mockSupabase = { from: jest.fn() };

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue({}),
  set: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: jest.fn(),
  parsePageRanges: jest.requireActual(
    '../../bot/shared/services/assessment/book-content.service').parsePageRanges,
}));

let SHELF;

function wireDb() {
  mockSupabase.from.mockImplementation((table) => {
    if (table !== 'textbooks') throw new Error(`unexpected table ${table}`);
    return {
      select: (cols) => ({
        eq: (_c, curriculum) => {
          const all = Object.entries(SHELF).flatMap(([g, subs]) =>
            subs.map((s) => ({ grade: Number(g), subject: s, curriculum })));
          if (cols === 'grade') return Promise.resolve({ data: all, error: null });
          return {
            eq: (_col, grade) => Promise.resolve({
              data: all.filter((r) => r.grade === Number(grade)), error: null,
            }),
          };
        },
      }),
    };
  });
}

const { handleAssessmentGenDataExchange } = require('../../bot/shared/routes/assessment-gen-endpoint');
const TeacherBooks = require('../../bot/shared/services/teacher-books.service');
const { subjectLabel, taughtIn } = require('../../bot/shared/services/assessment/assessment-vocabulary');

const menu = async (grade) => (await handleAssessmentGenDataExchange(
  'u1', 'CLASS', { trigger: 'grade_selected', grade: String(grade) }, 'tok')).data.subjects;

beforeEach(() => {
  jest.clearAllMocks();
  SHELF = {
    1: ['english', 'general_knowledge', 'general_knowledge_en', 'maths', 'urdu'],
    3: ['english', 'general_knowledge', 'maths', 'urdu'],
    4: ['english', 'maths', 'science', 'social_studies', 'social_studies_en', 'urdu'],
  };
  wireDb();
});

describe('an ICT teacher (no shelf) chooses the medium', () => {
  test('Grade 1 offers both General Knowledge books, each named by its medium', async () => {
    const gk = (await menu(1)).filter((s) => s.id.startsWith('general_knowledge'));
    expect(gk).toEqual(expect.arrayContaining([
      { id: 'general_knowledge', title: 'General Knowledge (Urdu)' },
      { id: 'general_knowledge_en', title: 'General Knowledge (English)' },
    ]));
    expect(gk).toHaveLength(2);
  });

  test('Grade 4 offers both Social Studies books, each named by its medium', async () => {
    const sst = (await menu(4)).filter((s) => s.id.startsWith('social_studies'));
    expect(sst).toEqual(expect.arrayContaining([
      { id: 'social_studies', title: 'Social Studies (Urdu)' },
      { id: 'social_studies_en', title: 'Social Studies (English)' },
    ]));
  });

  test('a grade holding the Urdu book only keeps today\'s plain name', async () => {
    const gk = (await menu(3)).filter((s) => s.id.startsWith('general_knowledge'));
    expect(gk).toEqual([{ id: 'general_knowledge', title: 'General Knowledge' }]);
  });

  test('every other subject keeps its name', async () => {
    const titles = Object.fromEntries((await menu(4)).map((s) => [s.id, s.title]));
    expect(titles.science).toBe('Science');
    expect(titles.english).toBe('English');
  });
});

describe('a shelf offers the book it holds, and only that one', () => {
  const GB = ['grade_1_general_knowledge_en', 'grade_4_social_studies_en', 'gb_g1_english'];
  const URDU = ['grade_1_general_knowledge', 'grade_4_social_studies'];

  test('GB\'s English books: English GK and SST, never the Urdu ones', () => {
    expect(TeacherBooks.assessmentOffered(1, 'general_knowledge_en', GB)).toBe(true);
    expect(TeacherBooks.assessmentOffered(4, 'social_studies_en', GB)).toBe(true);
    expect(TeacherBooks.assessmentOffered(1, 'general_knowledge', GB)).toBe(false);
    expect(TeacherBooks.assessmentOffered(4, 'social_studies', GB)).toBe(false);
  });

  test('a shelf of the Urdu books: Urdu GK and SST, never the English ones', () => {
    expect(TeacherBooks.assessmentOffered(1, 'general_knowledge', URDU)).toBe(true);
    expect(TeacherBooks.assessmentOffered(4, 'social_studies', URDU)).toBe(true);
    expect(TeacherBooks.assessmentOffered(1, 'general_knowledge_en', URDU)).toBe(false);
    expect(TeacherBooks.assessmentOffered(4, 'social_studies_en', URDU)).toBe(false);
  });

  test('no shelf offers both', () => {
    expect(TeacherBooks.assessmentOffered(1, 'general_knowledge_en', null)).toBe(true);
    expect(TeacherBooks.assessmentOffered(4, 'social_studies_en', null)).toBe(true);
  });
});

describe('the English codes are named and banded like their Urdu twins', () => {
  test('the printed name carries no medium: the paper says what it is', () => {
    expect(subjectLabel('general_knowledge_en')).toBe('General Knowledge');
    expect(subjectLabel('social_studies_en')).toBe('Social Studies');
  });

  test('GK stops at Grade 3 and Social Studies starts at Grade 4', () => {
    expect(taughtIn('general_knowledge_en', 3)).toBe(true);
    expect(taughtIn('general_knowledge_en', 4)).toBe(false);
    expect(taughtIn('social_studies_en', 3)).toBe(false);
    expect(taughtIn('social_studies_en', 5)).toBe(true);
  });
});
