/**
 * The eval plan: which chapters get an exam and what each exam asks for.
 *
 * Two exams per book. A mirrors what teachers actually submitted on 1 Sep
 * (a mix of seen + unseen, 15 questions, the default type mix). B takes a
 * different chapter and asks for new questions only, with a subjective type in
 * the mix, so the eval sees both halves of the prompt.
 */
const { pickChapters, examSpecs, summariseCounts } = require('../../scripts/assessment/eval-plan');

const chapters = [
  { n: 1, title: 'One', start: 1, end: 11 },
  { n: 3, title: 'Three', start: 25, end: 37 },
  { n: 4, title: 'Four', start: 38, end: 50 },
  { n: 6, title: 'Six', start: 67, end: 78 },
  { n: 8, title: 'Eight', start: 95, end: 109 },
];

describe('pickChapters', () => {
  test('A is the first chapter, B the middle one', () => {
    const { A, B } = pickChapters(chapters);
    expect(A.n).toBe(1);
    expect(B.n).toBe(4);
  });
  test('a one-chapter book uses it twice rather than failing', () => {
    const { A, B } = pickChapters([chapters[0]]);
    expect(A.n).toBe(1);
    expect(B.n).toBe(1);
  });
});

describe('examSpecs', () => {
  const specs = examSpecs({ grade: 1, subject: 'english', chapters });
  test('two exams on two chapters', () => {
    expect(specs).toHaveLength(2);
    expect(specs[0].chapterNumber).toBe(1);
    expect(specs[1].chapterNumber).toBe(4);
  });
  test('A mirrors the real 1 Sep requests: both, 15, default mix, answer key', () => {
    const a = specs[0];
    expect(a.label).toBe('A');
    expect(a.contentSource).toBe('both');
    expect(a.questionCount).toBe(15);
    expect(a.questionTypes.map((t) => t.id)).toEqual(['MCQs', 'Fill in the Blanks', 'True/False']);
    expect(a.questionTypes.reduce((s, t) => s + t.count, 0)).toBe(15);
    expect(a.includeAnswerKey).toBe(true);
  });
  test('B is unseen-only, 20, and carries one subjective type', () => {
    const b = specs[1];
    expect(b.contentSource).toBe('unseen');
    expect(b.questionCount).toBe(20);
    expect(b.questionTypes.reduce((s, t) => s + t.count, 0)).toBe(20);
    expect(b.questionTypes.filter((t) => t.category === 'subjective')).toHaveLength(1);
    expect(b.questionTypes.filter((t) => t.category === 'objective')).toHaveLength(2);
  });
  test('B picks a grade-appropriate subjective type', () => {
    const g1 = examSpecs({ grade: 1, subject: 'english', chapters })[1];
    const g5 = examSpecs({ grade: 5, subject: 'english', chapters })[1];
    expect(g1.questionTypes.find((t) => t.category === 'subjective').id).toBe('Word Meanings');
    expect(g5.questionTypes.find((t) => t.category === 'subjective').id).toBe('Word Meanings');
    const maths = examSpecs({ grade: 3, subject: 'maths', chapters })[1];
    expect(maths.questionTypes.find((t) => t.category === 'subjective').id).toBe('Short Questions');
  });
});

describe('summariseCounts', () => {
  test('counts per section and type, including Long Question sub-maps', () => {
    const exam = {
      seen: { objective: { MCQs: [{ q: 1 }, { q: 2 }] } },
      unseen: {
        objective: { MCQs: [{ q: 1 }], 'True/False': [{ q: 1 }, { q: 2 }, { q: 3 }] },
        subjective: { 'Long Question': { Essay: [{ q: 1 }], Letter: [{ q: 1 }] } },
      },
    };
    expect(summariseCounts(exam)).toEqual({
      seen: { MCQs: 2 },
      unseen: { MCQs: 1, 'True/False': 3, 'Long Question': 2 },
      seenTotal: 2,
      unseenTotal: 6,
      total: 8,
    });
  });
});
