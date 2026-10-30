/**
 * v37 G2 English Q1 (blocker): the model wrote "See the answer to each question." as the
 * reading item's own answer, the scheme pass built a 20-mark row from it, and the key printed
 * that one row instead of the ten part answers. A passage item whose parts carry their own
 * answers has no answer of its own.
 */

const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { dropPassageAnswer } = require('../../bot/shared/services/assessment/fde-sub-answers');
const english = require('./fixtures/early/g1-english-exam.json');

const SLOT = 'g1.english.C.Q13';
const PARTS = [
  { question: 'What did Zara and Bilal plant in a pot?', answer: 'A small seed.', marks: 2,
    scheme: { points: [{ kind: 'A', text: 'Names a seed', marks: 2 }] } },
  { question: 'Why did Zara clap her hands?', answer: 'She was happy.', marks: 2,
    scheme: { points: [{ kind: 'U', text: 'Says she was happy', marks: 2 }] } },
];
const PLACEHOLDER = 'See the answer to each question.';

function readingPaper(extra) {
  const exam = JSON.parse(JSON.stringify(english));
  exam._layout.sections.forEach((s) => s.slots.forEach((sl) => {
    if (sl.slot === SLOT) Object.assign(sl, { generate: 1, attempt: 1, marks_each: 4, lines: 0 });
  }));
  Object.values(exam.unseen).forEach((c) => Object.keys(c).forEach((k) => {
    if (c[k][0] && c[k][0].slot === SLOT) {
      c[k] = [{ slot: SLOT, lines: 0, marks: 4, blooms: 'Understand', main_question: 'Read and answer.',
        passage: 'Zara and her brother Bilal planted a small seed in a pot.',
        questions: JSON.parse(JSON.stringify(PARTS)), ...extra }];
    }
  }));
  return exam;
}
const rowsOf = (html) => html.split('<tr').filter((r) => r.includes(`data-row="${SLOT}"`));
const item = (exam) => Object.values(exam.unseen).flatMap((c) => Object.values(c)).flat().find((q) => q && q.slot === SLOT);

describe('v37 a passage item with answered parts has no answer of its own', () => {
  test('dropPassageAnswer removes the placeholder answer and its scheme', () => {
    const q = { passage: 'p', answer: PLACEHOLDER, scheme: { points: [] }, questions: JSON.parse(JSON.stringify(PARTS)) };
    expect(dropPassageAnswer(q)).toBe(true);
    expect(q.answer).toBeUndefined();
    expect(q.scheme).toBeUndefined();
  });

  test('an item with no passage keeps its answer', () => {
    const q = { answer: 'x', questions: JSON.parse(JSON.stringify(PARTS)) };
    expect(dropPassageAnswer(q)).toBe(false);
    expect(q.answer).toBe('x');
  });

  test('a passage item whose parts are not all answered keeps its answer', () => {
    const q = { passage: 'p', answer: 'x', questions: [PARTS[0], { question: 'No answer here?' }] };
    expect(dropPassageAnswer(q)).toBe(false);
    expect(q.answer).toBe('x');
  });

  test('the scheme pass writes no parent row and the key prints each part', () => {
    const { examJson } = normaliseScheme(readingPaper({ answer: PLACEHOLDER }));
    expect(item(examJson).answer).toBeUndefined();
    expect((examJson._layout.scheme_shortfall || []).filter((e) => e.slot === SLOT && e.part === undefined)).toHaveLength(0);
    const html = R.renderMarkingScheme({ examJson, grade: 2, subject: 'english', allowShort: true });
    expect(html).not.toContain(PLACEHOLDER);
    expect(rowsOf(html)).toHaveLength(PARTS.length);
    expect(html).not.toContain('written from the answer');
  });
});
