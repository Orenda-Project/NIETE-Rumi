/**
 * bd-cj8ggk.1 — field report: "the question sequence gets mixed up after editing and saving".
 *
 * exam_json is jsonb, and jsonb does not keep key order: it hands keys back shortest-first. The first
 * paper prints from the in-memory tree (the model's order); every re-render after an edit prints from
 * the stored row, so "MCQs" (4 chars) came before "Fill in the Blanks", and "subjective"/"objective"
 * could swap. The paper and the editor's list now walk one fixed order, whatever order the keys arrive in:
 * objective before subjective; Fill in the Blanks, MCQs, MSQs, Missing Letters, then the other objective
 * types; Short before the rest, Long/written work last.
 */

const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');
const { orderedEntries } = require('../../bot/shared/services/assessment/assessment-order');

const q = (text) => ({ question: text, marks: 1 });

// Keys as jsonb returns them: by length, then bytes. This is what an edited paper's row looks like.
const STORED = {
  unseen: {
    objective: {
      MCQs: [q('mcq')],
      'True/False': [q('tf')],
      'Missing Letters': [q('ml')],
      'Match the Column': [{ question: 'match', column_a: ['a'], column_b: ['b'], marks: 1 }],
      'Fill in the Blanks': [q('fib')],
    },
    subjective: {
      'Long Question': [q('long')],
      'Short Questions': [q('short')],
    },
  },
};
// jsonb also puts "objective" (9) before "subjective" (10) only by luck; build the worse case too.
const SWAPPED = { unseen: { subjective: STORED.unseen.subjective, objective: STORED.unseen.objective } };

const printed = (tree) => Renderer.collectQuestions(tree).map((x) => x.question.question);
const EXPECTED = ['fib', 'mcq', 'ml', 'tf', 'match', 'short', 'long'];

describe('a paper prints in one fixed order, whatever order its stored keys come back in', () => {
  test('collectQuestions: Fill in the Blanks, MCQs, Missing Letters, other objective, Short, Long', () => {
    expect(printed(STORED)).toEqual(EXPECTED);
    expect(printed(SWAPPED)).toEqual(EXPECTED);
  });

  test('the printed paper carries the headings in that order', () => {
    const html = Renderer.renderPaper({ examJson: SWAPPED, grade: 3, subject: 'english' });
    const at = (h) => html.indexOf(`<h3 class="type">${h}</h3>`);
    const order = ['Fill in the Blanks', 'MCQs', 'Missing Letters', 'True/False', 'Match the Column', 'Short Questions', 'Long Question'].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('the editor list numbers questions as the paper prints them', () => {
    const listed = Selection.indexQuestions(SWAPPED);
    expect(listed.map((x) => x.text)).toEqual(EXPECTED);
    expect(listed.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('a question added later as a new type lands in its place, not at the end', () => {
    const t = JSON.parse(JSON.stringify(STORED));
    delete t.unseen.objective['Fill in the Blanks'];
    t.unseen.objective['Fill in the Blanks'] = [q('fib')]; // appended last, as placeTyped does
    expect(printed(t)).toEqual(EXPECTED);
  });
});

describe('orderedEntries', () => {
  test('unknown types keep their relative order inside their bucket', () => {
    const keys = orderedEntries({ Zeta: 1, 'Fill in the blanks': 2, Alpha: 3, MCQ: 4 }, 'type').map(([k]) => k);
    expect(keys).toEqual(['Fill in the blanks', 'MCQ', 'Zeta', 'Alpha']);
  });

  test('categories: objective, subjective, then anything else', () => {
    expect(orderedEntries({ other: 1, subjective: 2, objective: 3 }, 'category').map(([k]) => k))
      .toEqual(['objective', 'subjective', 'other']);
  });

  test('long and written work sorts after short and the rest', () => {
    const keys = orderedEntries({ 'Essay Writing': 1, 'Word Problems': 2, 'Brief Answers': 3, 'Short Questions': 4 }, 'type').map(([k]) => k);
    expect(keys).toEqual(['Brief Answers', 'Short Questions', 'Word Problems', 'Essay Writing']);
  });
});
