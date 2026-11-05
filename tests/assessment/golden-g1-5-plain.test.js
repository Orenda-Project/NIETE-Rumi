/**
 * Goldens for the plain (no board pattern) path, grades 1-5, widening golden.test.js (captured at 820045b41).
 *
 *   user prompt       buildUserPrompt for all seven subjects x G1, G3, G5 (golden.test.js holds G4-5 only)
 *   paper + key HTML  renderPaper / renderAnswerKey for all seven subjects x G1, G3, G5
 *   options JSON      POST /assessment/options through the REAL browse service over fake `textbooks` rows
 *                     (golden.test.js mocks listGrades/listSubjects, so it cannot see what the rows offer)
 *
 * Inputs are the fictional fixtures golden.test.js already uses: an Urdu-script subject renders
 * exam.urdu.json, an English-script one exam.science.json (maths: exam.maths.json).
 *
 * Flag states: every case runs with assessment_grades_6_12 absent and with it true, against ONE file
 * named `g612-absent`. A third state, flag true WITH G6-12 `textbooks` rows present, re-runs the
 * per-grade G1-5 cells against the same files: `grades` must then read 1..12 (by design) and every
 * other byte must match. The no-grade call is that list alone, pinned in assessment-grade-gate-routes.test.js.
 */
const fs = require('fs');
const path = require('path');
const H = require('./helpers/golden-g1-5');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: jest.fn() } } }),
}));

const SUBJECTS = ['english', 'urdu', 'maths', 'science', 'social_studies', 'islamiat', 'general_knowledge'];
const GRADES = [1, 3, 5];
const GRID = [];
GRADES.forEach((g) => SUBJECTS.forEach((s) => GRID.push([g, s])));
const URDU_SCRIPT = new Set(['urdu', 'islamiat', 'general_knowledge', 'social_studies']);
const exam = (s) => {
  const f = s === 'maths' ? 'maths' : URDU_SCRIPT.has(s) ? 'urdu' : 'science';
  return JSON.parse(fs.readFileSync(path.join(H.DIR, `exam.${f}.json`), 'utf8'));
};

describe('golden G1-5 plain: user prompt', () => {
  const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
  const PAGE = '=== Page 12 ===\nOur school\nWe go to school every day.\n=== Page 13 ===\nWe help each other.';
  test.each(GRID)('grade %i %s', (grade, subject) => {
    const prompt = Gen.buildUserPrompt({
      grade, subject, pageContent: PAGE, pageReference: '12-13', contentSource: 'unseen', questionCount: 8,
      questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }, { id: 'Short Questions', count: 4, category: 'subjective' }],
    });
    H.golden(`plain/g${grade}.${subject}.plain.g612-absent.user-prompt.txt`, prompt);
  });
});

describe('golden G1-5 plain: the printed paper and its key', () => {
  const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
  test.each(GRID)('grade %i %s', (grade, subject) => {
    const meta = { grade, subject, schoolName: 'Model School Example', pageReference: '12-40', chapterTitle: 'Our School' };
    H.golden(`plain/g${grade}.${subject}.plain.g612-absent.paper.html`,
      H.digests(Renderer.renderPaper({ examJson: exam(subject), ...meta, answerLines: true })));
    H.golden(`plain/g${grade}.${subject}.plain.g612-absent.key.html`,
      H.digests(Renderer.renderAnswerKey({ examJson: exam(subject), ...meta })));
  });
});

const ON = { assessment_grades_6_12: true };
describe.each([['absent', {}, false], ['true', ON, false], ['true + G6-12 rows', ON, true]])('golden G1-5 options, assessment_grades_6_12 %s', (_n, g612, highRows) => {
  const KEY = 'golden-g1-5-key';
  let router;
  const state = { rows: {}, seq: 0, updates: [], settings: { ...g612 }, tables: {} };
  // Every ICT book prod holds for G1-5 (one row per grade x subject; the band filter drops the untaught).
  state.tables.textbooks = [];
  [1, 2, 3, 4, 5].forEach((grade) => SUBJECTS.forEach((subject) => state.tables.textbooks.push(
    { id: `book-${grade}-${subject}`, curriculum: 'ict', grade, subject })));
  if (highRows) [6, 7, 8, 9, 10, 11, 12].forEach((grade) => ['english', 'urdu', 'maths'].forEach((subject) => state.tables.textbooks.push(
    { id: `book-${grade}-${subject}`, curriculum: 'ict', grade, subject })));

  beforeAll(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = KEY;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => H.fakeDb(state));
    router = require('../../bot/shared/routes/internal-api.routes');
  });
  afterAll(() => { delete process.env.INTERNAL_API_KEY; jest.resetModules(); });

  (highRows ? test.skip : test)('with no grade', async () => {
    H.golden('options/none.options.g612-absent.json', H.json(await H.callRoute(router, '/assessment/options', {}, KEY)));
  });
  const OPT = [];
  [1, 2, 3, 4, 5].forEach((g) => SUBJECTS.forEach((s) => OPT.push([g, s])));
  test.each(OPT)('grade %i %s', async (grade, subject) => {
    const out = await H.callRoute(router, '/assessment/options', { grade, subject, userId: 'u-golden-1' }, KEY);
    if (highRows) { // The flag offers 6-12 in `grades` (by design); everything else must not move a byte.
      expect(out.payload.grades).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      out.payload.grades = [1, 2, 3, 4, 5];
    }
    H.golden(`options/g${grade}.${subject}.options.g612-absent.json`, H.json(out));
  });
});
