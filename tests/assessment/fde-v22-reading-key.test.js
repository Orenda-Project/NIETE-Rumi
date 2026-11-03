/**
 * bd-5jmnfj.4.50.2: G2 English Q1 is one passage with ten lettered parts, each carrying its
 * own { question, answer, marks, scheme } and the item no answer of its own. The v22 key
 * printed one row "i)" with a "20" box and none of the ten answers.
 */

const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { answeredParts } = require('../../bot/shared/services/assessment/fde-sub-answers');
const english = require('./fixtures/early/g1-english-exam.json');

const SLOT = 'g1.english.C.Q13';
const PARTS = [
  { question: 'What did Zara and Bilal plant in a pot?', answer: 'A small seed.', marks: 2,
    scheme: { points: [{ kind: 'A', text: 'Correct answer: a seed', marks: 2 }], accept: ['seed'], common_error: 'Writing plant.' } },
  { question: 'Why did Zara clap her hands?', answer: 'She was happy because the leaf was growing.', marks: 2,
    scheme: { points: [{ kind: 'U', text: 'Says she was happy', marks: 1 }, { kind: 'A', text: 'Gives the reason', marks: 1 }] } },
];

// The fixture's Q13 becomes a v22-shaped reading block: one item, a passage, answered parts.
function readingPaper() {
  const exam = JSON.parse(JSON.stringify(english));
  exam._layout.sections.forEach((s) => s.slots.forEach((sl) => {
    if (sl.slot === SLOT) Object.assign(sl, { generate: 1, attempt: 1, marks_each: 4, lines: 0 });
  }));
  Object.values(exam.unseen).forEach((c) => Object.keys(c).forEach((k) => {
    if (c[k][0] && c[k][0].slot === SLOT) {
      c[k] = [{ slot: SLOT, lines: 0, marks: 4, blooms: 'Understand', main_question: 'Read and answer.',
        passage: 'Zara and her brother Bilal planted a small seed in a pot.', questions: JSON.parse(JSON.stringify(PARTS)) }];
    }
  }));
  return exam;
}
const rowsOf = (html) => html.split('<tr').filter((r) => r.includes(`data-row="${SLOT}"`));

describe('bd-5jmnfj.4.50.2 the key prints each reading part\'s answer', () => {
  const rows = rowsOf(R.renderMarkingScheme({ examJson: readingPaper(), grade: 2, subject: 'english', allowShort: true }));

  test('one row per part, lettered as the paper letters them', () => {
    expect(rows).toHaveLength(PARTS.length);
    expect(rows[0]).toContain('(a)');
    expect(rows[1]).toContain('(b)');
  });

  test('each row carries its answer, its question and its own points', () => {
    PARTS.forEach((p, i) => {
      expect(rows[i]).toContain(p.answer);
      expect(rows[i]).toContain(p.question);
      p.scheme.points.forEach((pt) => expect(rows[i]).toContain(pt.text));
    });
    expect(rows[0]).toContain('accept: seed');
  });

  test('no row is a bare marks box', () => {
    rows.forEach((r) => expect(r).toMatch(/<td class="ans"><b>[^<]+<\/b>/));
  });
});

describe('answeredParts', () => {
  test('parts with answers and no answer on the item', () => {
    expect(answeredParts({ questions: PARTS })).toBe(PARTS);
  });

  test.each([
    ['an item with its own answer (a story to order)', { answer: '2, 3, 1', questions: ['1. a', '2. b', '3. c'] }],
    ['plain-string parts', { questions: ['1. a', '2. b'] }],
    ['parts with no answers', { questions: [{ question: 'Why?' }] }],
    ['no parts', { question: 'Why?' }],
    ['nothing', null],
  ])('null for %s', (_, q) => {
    expect(answeredParts(q)).toBeNull();
  });
});
