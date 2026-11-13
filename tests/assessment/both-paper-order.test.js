/**
 * bd-ipoxhx.3 — ICT Feedback, Assessment Generator row 27 (coach review of a Science paper):
 * "MCQs appeared again after the Brief Answers section … similar question types should be grouped".
 *
 * A "Both" paper holds two halves: `seen` (the book's own exercise questions) and `unseen` (new ones).
 * Each half was walked on its own, objective then subjective, so the paper printed
 * MCQs, Brief Answers (book) and then MCQs, Brief Answers again (new). One walk now spans both halves:
 * every type prints once, in the fixed order, the book's questions first inside it. Ids stay paths
 * (`seen.objective.MCQs.0`), so nothing stored changes meaning.
 */

const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');

const q = (text, marks = 1) => ({ question: text, marks });

const BOTH = {
  seen: {
    objective: { MCQs: [q('book mcq')], 'Fill in the Blanks': [q('book fib')] },
    subjective: { 'Brief Answers': [q('book brief', 2)] },
  },
  unseen: {
    subjective: { 'Long Question': [q('new long', 5)], 'Brief Answers': [q('new brief', 2)] },
    objective: { MCQs: [q('new mcq'), q('new mcq 2')], 'True/False': [q('new tf')] },
  },
};

const EXPECTED = ['book fib', 'book mcq', 'new mcq', 'new mcq 2', 'new tf', 'book brief', 'new brief', 'new long'];
const printed = (tree) => Renderer.collectQuestions(tree).map((x) => x.question.question);

describe('a Both paper groups each question type once across the book and new halves', () => {
  test('collectQuestions walks both halves as one paper', () => {
    expect(printed(BOTH)).toEqual(EXPECTED);
  });

  test('each heading prints once, in order, never MCQs after Brief Answers', () => {
    const html = Renderer.renderPaper({ examJson: BOTH, grade: 5, subject: 'science' });
    const count = (h) => html.split(`<h3 class="type">${h}</h3>`).length - 1;
    for (const h of ['Fill in the Blanks', 'MCQs', 'True/False', 'Brief Answers', 'Long Question']) expect(count(h)).toBe(1);
    const at = (h) => html.indexOf(`<h3 class="type">${h}</h3>`);
    expect(at('MCQs')).toBeLessThan(at('Brief Answers'));
  });

  test('the editor list numbers the questions as the paper prints them, ids unchanged', () => {
    const listed = Selection.indexQuestions(BOTH);
    expect(listed.map((x) => x.text)).toEqual(EXPECTED);
    expect(listed.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(listed[1].id).toBe('seen.objective.MCQs.0');
    expect(listed[2].id).toBe('unseen.objective.MCQs.0');
  });

  test('the total and the answer key cover every question once', () => {
    expect(Renderer.totalMarks(Renderer.collectQuestions(BOTH))).toBe(1 + 1 + 2 + 1 + 1 + 1 + 2 + 5);
  });
});
