/**
 * bd-fmf24g.31 — reading a finished paper's own questions for the portal's paper page.
 * Same tree the PDF and the editor read (exam_json); no editing switch needed to LOOK at a paper;
 * ownership checked in the query; answers never leave.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const { makeFakeDb } = require('./helpers/fake-postgrest');
let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.client.from(t) }));
jest.mock('../../bot/shared/storage/r2', () => ({}));

const View = require('../../bot/shared/services/assessment/assessment-paper-view.service');

const U = 'u1';
const REQ = { id: 'r1', user_id: U, grade_code: 'grade_4', subject_code: 'science', chapter_number: 3 };
const TREE = {
  seen: {
    objective: {
      MCQs: [
        { question: 'Which part takes in water?', options: ['A) Roots', 'B) Stem'], answer: 'A) Roots', marks: 1 },
        { question: 'Gone', options: ['A) x'], marks: 5, removed: true },
        { question: 'Plants make food in:', options: ['A) Roots', 'B) Leaves'], answer: 'B) Leaves', marks: 1 },
      ],
      'True/False': [{ main_question: 'Write True or False', question: 'Seeds need light.', answer: 'False', marks: 1 }],
      'Match the Column': [{ question: 'Match.', column_a: ['Sun', 'Moon'], column_b: ['Day', 'Night', 'Extra'], marks: 2 }],
      'Fill in the blanks': [{ question: 'Fill in', words: ['one', 'two'], marks: 2 }],
    },
    subjective: {
      Comprehension: [{
        question: 'Read and answer.', passage: 'A crow was thirsty.\nIt found a jug.',
        questions: [{ question: 'Who was thirsty?', marks: 1, answer: 'The crow' }, { question: 'Pick', options: ['A) a', 'B) b'], marks: 2 }],
      }],
      other: [{ question: 'Name two things plants need.', answer: 'Water, light', marks: 2, lines: 3 }],
    },
  },
};
const paper = (id, over = {}) => ({
  id, request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: TREE,
  created_at: '2026-09-30T09:00:00.000Z', question_count: 7, total_marks: 10, ...over,
});

function seed(papers = [paper('v1')], settings = [], reqs = [REQ]) {
  mockDb = makeFakeDb({ assessment_requests: reqs, assessment_papers: papers, app_settings: settings });
}
beforeEach(() => seed());

describe('buildPaperView', () => {
  const { buildPaperView } = View;
  const sections = () => buildPaperView(TREE);

  test('sections follow the paper, one per question type, numbered straight through, removed questions skipped', () => {
    const s = sections();
    expect(s.map((x) => x.heading)).toEqual(['MCQs', 'True/False', 'Match the Column', 'Fill in the blanks', 'Comprehension', null]);
    expect(s[0].questions.map((q) => q.number)).toEqual([1, 2]);
    expect(s[1].questions[0].number).toBe(3);
    expect(s.flatMap((x) => x.questions).length).toBe(7);
  });

  test('a shared instruction is the section lead', () => {
    expect(sections()[1].lead).toBe('Write True or False');
    expect(sections()[0].lead).toBeNull();
  });

  test('MCQ options and marks', () => {
    const q = sections()[0].questions[0];
    expect(q).toMatchObject({ shape: 'options', text: 'Which part takes in water?', marks: 1, options: ['A) Roots', 'B) Stem'] });
  });

  test('match columns pad to the longer side', () => {
    const q = sections()[2].questions[0];
    expect(q.shape).toBe('columns');
    expect(q.pairs).toEqual([{ left: 'Sun', right: 'Day' }, { left: 'Moon', right: 'Night' }, { left: '', right: 'Extra' }]);
  });

  test('words, passage with sub-questions (lettered, own marks, own options); marks of a passage question = its parts', () => {
    const s = sections();
    expect(s[3].questions[0]).toMatchObject({ shape: 'words', words: ['one', 'two'] });
    const c = s[4].questions[0];
    expect(c).toMatchObject({ shape: 'comprehension', passage: 'A crow was thirsty.\nIt found a jug.', marks: 3 });
    expect(c.subs).toEqual([
      { letter: 'a', text: 'Who was thirsty?', marks: 1, options: [] },
      { letter: 'b', text: 'Pick', marks: 2, options: ['A) a', 'B) b'] },
    ]);
  });

  test('a generic bucket has no heading; the answer NEVER leaves', () => {
    expect(sections()[5].heading).toBeNull();
    expect(JSON.stringify(sections())).not.toMatch(/Water, light|The crow|"answer"|Leaves"\s*,\s*"answer/);
    expect(JSON.stringify(sections())).not.toContain('"answer"');
  });

  test('no tree, or an empty one, is no sections', () => {
    expect(buildPaperView(null)).toEqual([]);
    expect(buildPaperView({})).toEqual([]);
    expect(buildPaperView({ seen: { objective: { MCQs: [] } } })).toEqual([]);
  });
});

describe('view', () => {
  test('her own ready paper: the head and its sections — with the editing switch OFF', async () => {
    seed([paper('v1')], [{ key: 'portal_assessment_editing_enabled', value: false }, { key: 'assessment_editing_enabled', value: false }]);
    const out = await View.view({ paperId: 'v1', userId: U });
    expect(out.paper).toMatchObject({ paperId: 'v1', version: 1, grade: 4, subject: 'science', chapterNumber: 3, rtl: false, questionCount: 7, marks: 12 });
    expect(out.sections.length).toBe(6);
  });

  test('an Urdu-side subject is rtl', async () => {
    seed([paper('v1')], [], [{ ...REQ, subject_code: 'urdu' }]);
    expect((await View.view({ paperId: 'v1', userId: U })).paper.rtl).toBe(true);
  });

  test("someone else's paper is not found", async () => {
    expect(await View.view({ paperId: 'v1', userId: 'someone-else' })).toEqual({ code: 'NOT_FOUND' });
  });

  test('a paper still being written is not ready', async () => {
    seed([paper('v1', { status: 'generating' })]);
    expect(await View.view({ paperId: 'v1', userId: U })).toEqual({ code: 'NOT_READY' });
  });

  test('a paper with no stored questions comes back with none, not an error', async () => {
    seed([paper('v1', { exam_json: null })]);
    const out = await View.view({ paperId: 'v1', userId: U });
    expect(out.sections).toEqual([]);
    expect(out.paper.paperId).toBe('v1');
  });
});
