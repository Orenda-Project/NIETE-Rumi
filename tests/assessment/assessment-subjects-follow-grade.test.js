/**
 * The subjects offered must be the ones for the grade she picked.
 *
 * Grade and Subject are two Dropdowns on one CLASS screen. The Grade dropdown
 * had no on-select-action, so choosing a grade never asked us for its subjects:
 * the list stayed whatever INIT rendered, which is `subjectsOnOffer(grades[0])`
 * — Grade 1's. Grade 1 has no Science and no Social Studies, so a Grade 4 or 5
 * teacher could never see either. Reported from the field (NIETE bug sheet,
 * Assessment Generator row 9, Rabia Javed: "Science is not visible in grade 4";
 * operator confirmed on prod for G4 AND G5, 2026-09-29).
 *
 * They only ever surfaced by accident: submit a pair her grade does not hold and
 * the stale-pair guard re-renders CLASS with the right list.
 */

const mockSupabase = { from: jest.fn() };
const mockListChapters = jest.fn();

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue({}),
  set: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: (...a) => mockListChapters(...a),
  parsePageRanges: jest.requireActual(
    '../../bot/shared/services/assessment/book-content.service').parsePageRanges,
}));

// The live ICT shelf (NIETE prod `textbooks`, curriculum = 'ict', 2026-09-29).
const SHELF = {
  1: ['english', 'general_knowledge', 'islamiat', 'maths', 'urdu'],
  2: ['english', 'general_knowledge', 'islamiat', 'maths', 'urdu'],
  3: ['english', 'general_knowledge', 'islamiat', 'maths', 'urdu'],
  4: ['english', 'islamiat', 'maths', 'science', 'social_studies', 'urdu'],
  5: ['english', 'islamiat', 'maths', 'science', 'social_studies', 'urdu'],
};

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

const {
  handleAssessmentGenInit, handleAssessmentGenDataExchange,
} = require('../../bot/shared/routes/assessment-gen-endpoint');

beforeEach(() => {
  jest.clearAllMocks();
  wireDb();
});

describe('the Grade dropdown asks for its subjects when she picks a grade', () => {
  const fs = require('fs');
  const path = require('path');
  const gradeField = () => {
    const flow = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../docs/flows/assessment-gen-flow.json'), 'utf8'));
    const form = flow.screens.find((s) => s.id === 'CLASS').layout.children
      .find((c) => c.type === 'Form');
    return form.children.find((c) => c.name === 'grade');
  };

  test('choosing a grade is a data_exchange carrying the grade', () => {
    const action = gradeField()['on-select-action'];
    expect(action).toBeDefined();
    expect(action.name).toBe('data_exchange');
    expect(action.payload).toEqual({ trigger: 'grade_selected', grade: '${form.grade}' });
  });
});

describe('the endpoint answers a grade change with that grade\'s subjects', () => {
  const ids = (res) => res.data.subjects.map((s) => s.id);

  test.each([4, 5])('Grade %i offers Science and Social Studies', async (grade) => {
    const res = await handleAssessmentGenDataExchange(
      'u1', 'CLASS', { trigger: 'grade_selected', grade: String(grade) }, 'tok');
    expect(res.screen).toBe('CLASS');
    expect(ids(res)).toEqual(expect.arrayContaining(['science', 'social_studies']));
    expect(ids(res)).not.toContain('general_knowledge');
    expect(res.data.error).toBe('');
    expect(res.data.has_error).toBe(false);
  });

  test.each([1, 2, 3])('Grade %i offers General Knowledge, never Science', async (grade) => {
    const res = await handleAssessmentGenDataExchange(
      'u1', 'CLASS', { trigger: 'grade_selected', grade: String(grade) }, 'tok');
    expect(ids(res)).toContain('general_knowledge');
    expect(ids(res)).not.toEqual(expect.arrayContaining(['science']));
  });

  test('a grade change is not a submit: no chapters are fetched, no screen advances', async () => {
    const res = await handleAssessmentGenDataExchange(
      'u1', 'CLASS', { trigger: 'grade_selected', grade: '4' }, 'tok');
    expect(res.screen).toBe('CLASS');
    expect(mockListChapters).not.toHaveBeenCalled();
    // The grade list is still there to render the Dropdown she is holding.
    expect(res.data.grades.map((g) => g.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  test('Continue still submits: a valid G4 Science pair moves on to COVERAGE', async () => {
    mockListChapters.mockResolvedValue([
      { chapterNumber: 1, title: 'Living things', pageStart: 4, pageEnd: 20 },
    ]);
    const res = await handleAssessmentGenDataExchange(
      'u1', 'CLASS', { grade: '4', subject: 'science' }, 'tok');
    expect(res.screen).toBe('COVERAGE');
    expect(mockListChapters).toHaveBeenCalledWith({ grade: 4, subject: 'science' });
  });

  test('INIT still renders CLASS with every grade', async () => {
    const res = await handleAssessmentGenInit('u1', 'tok');
    expect(res.screen).toBe('CLASS');
    expect(res.data.grades.map((g) => g.id)).toEqual(['1', '2', '3', '4', '5']);
  });
});
