/**
 * Never a lump chip.
 *
 * A written row the model gave no usable points prints only what it is worth
 * (a bare «2.5» or «5» chip): the teacher marking forty copies is left with no
 * answer to mark against and no kind. normaliseScheme now gives such a row one
 * Accuracy point worth the row's marks, carrying the answer, and records it in
 * `_layout.scheme_shortfall` so the before-the-exam box can say how many rows
 * code filled. A row with no answer either cannot be filled: its slot is short
 * and the engine re-asks the section.
 *
 * The Science fixture is a recorded sandbox paper (Q2(b), the magnet situation,
 * part a: a scheme with accept and common_error but no points).
 */

const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const SCIENCE = require('./fixtures/fde/r7-science-full1.exam.json');
// normaliseScheme's output on the same paper before this change.
const SCIENCE_TODAY = require('./fixtures/fde/r7-science-full1.normalised-today.json');

const P = Patterns.get('fde_g5_2027');
const layoutOf = (subject) => ({ v: 2, subject, sections: P.subjects[subject].sections });

const Q2B = 'Logical Reasoning';
const clone = (v) => JSON.parse(JSON.stringify(v));

// Every holder that prints a points row, keyed by where it sits.
function pointRows(exam) {
  const rows = new Map();
  const walk = (x, at) => {
    if (Array.isArray(x)) { x.forEach((y, i) => walk(y, `${at}[${i}]`)); return; }
    if (!x || typeof x !== 'object') return;
    if (x.scheme && Array.isArray(x.scheme.points) && x.scheme.points.length) rows.set(at, x.scheme);
    Object.keys(x).filter((k) => k !== '_layout').forEach((k) => walk(x[k], `${at}.${k}`));
  };
  walk(exam, '');
  return rows;
}

function wordProblem(points) {
  return {
    slot: 'maths.B.Q2',
    question: 'A shop sold goods worth Rs. 500,000 and spent Rs. 172,250. How much is left?',
    answer: 'Rs. 327,750',
    marks: 5,
    blooms: 'Apply',
    scheme: { points, accept: ['subtracting one amount at a time'], common_error: '422,250 as the answer' },
  };
}

const mathsPaper = (q) => ({ _layout: layoutOf('maths'), unseen: { subjective: { 'Word Problems': [q] } } });

describe('fix-r7-scheme: never a lump chip', () => {
  test('no-points part → A<marks> synthesised + shortfall', () => {
    const before = SCIENCE.unseen.subjective[Q2B][2].questions[0];
    expect(before.scheme.points).toBeUndefined(); // the recorded red row

    const { examJson, shortfall } = normaliseScheme(SCIENCE);
    const part = examJson.unseen.subjective[Q2B][2].questions[0];
    expect(part.scheme.points).toEqual([
      { kind: 'A', marks: 2.5, text: 'The steel paper clip and the iron pin.' },
    ]);
    // What the model did write is kept.
    expect(part.scheme.accept).toEqual(['Objects made of iron or steel']);
    expect(part.scheme.common_error).toBe('Saying the magnet attracts all metals, including aluminium.');
    expect(examJson._layout.scheme_shortfall).toEqual([
      { slot: 'science.B.Q2b', item: 2, part: 'a', filled_by: 'code' },
    ]);
    // A filled row is not a short slot: the paper is not failed or re-asked for it.
    expect(shortfall).toEqual([]);
  });

  test('17 rows with points unchanged', () => {
    // The brief counted 17; this paper carries 26 rows with points before the fill.
    const { examJson } = normaliseScheme(SCIENCE);
    const today = pointRows(SCIENCE_TODAY);
    const now = pointRows(examJson);
    expect(today.size).toBe(26);
    expect(now.size).toBe(27);
    for (const [at, scheme] of today) expect(now.get(at)).toEqual(scheme);
    // Nothing else on the paper moved: only the filled row and the new layout key differ.
    const a = clone(examJson);
    delete a._layout.scheme_shortfall;
    delete a.unseen.subjective[Q2B][2].questions[0].scheme.points;
    expect(a).toEqual(SCIENCE_TODAY);
  });

  test('maths lump 5 never prints', () => {
    // Points that add to 4 of 5 are dropped (a wrong split is a wrong instruction)…
    const q = wordProblem([
      { text: 'Subtracts the amounts', marks: 2, kind: 'M' },
      { text: '327,750', marks: 2, kind: 'A' },
    ]);
    const { examJson, shortfall } = normaliseScheme(mathsPaper(q));
    const out = examJson.unseen.subjective['Word Problems'][0];
    // …and the row is then one Accuracy point on the answer, never a bare «5».
    expect(out.scheme.points).toEqual([{ kind: 'A', marks: 5, text: 'Rs. 327,750' }]);
    expect(out.scheme.accept).toEqual(['subtracting one amount at a time']);
    expect(out.scheme.checked).toBeNull();
    expect(examJson._layout.scheme_shortfall).toEqual([
      { slot: 'maths.B.Q2', item: 0, part: null, filled_by: 'code' },
    ]);
    expect(shortfall).toEqual([]);
  });

  test('a written item with no scheme at all gets one', () => {
    const q = wordProblem([]);
    delete q.scheme;
    const { examJson } = normaliseScheme(mathsPaper(q));
    const out = examJson.unseen.subjective['Word Problems'][0];
    expect(out.scheme).toEqual({ points: [{ kind: 'A', marks: 5, text: 'Rs. 327,750' }], checked: null });
  });

  test('a part with no answer either → the slot is short, nothing synthesised', () => {
    const exam = clone(SCIENCE);
    const sub = exam.unseen.subjective[Q2B][2].questions[0];
    delete sub.answer;
    const { examJson, shortfall } = normaliseScheme(exam);
    expect(examJson.unseen.subjective[Q2B][2].questions[0].scheme.points).toBeUndefined();
    expect(examJson._layout.scheme_shortfall).toBeUndefined();
    expect(shortfall).toEqual([{ slot: 'science.B.Q2b', kind: 'answer', item: 2, part: 'a', have: 0, need: 1 }]);
  });

  test('a removed item with an unanswered part is not short (it does not print)', () => {
    const exam = clone(SCIENCE);
    const item = exam.unseen.subjective[Q2B][2];
    delete item.questions[0].answer;
    item.removed = true;
    const { shortfall } = normaliseScheme(exam);
    expect(shortfall).toEqual([]);
  });

  test('a part answered on the parent («a) … b) …») is filled from its letter', () => {
    const exam = clone(SCIENCE);
    const item = exam.unseen.subjective[Q2B][2];
    delete item.questions[0].answer;
    item.answer = 'a) The clip and the pin. b) Wood is not magnetic. c) The field acts at a distance.';
    const { examJson, shortfall } = normaliseScheme(exam);
    expect(examJson.unseen.subjective[Q2B][2].questions[0].scheme.points)
      .toEqual([{ kind: 'A', marks: 2.5, text: 'The clip and the pin.' }]);
    expect(shortfall).toEqual([]);
  });

  test('a paper with every row pointed carries no scheme_shortfall key', () => {
    const q = wordProblem([
      { text: 'Subtracts the amounts', marks: 3, kind: 'M' },
      { text: '327,750', marks: 2, kind: 'A' },
    ]);
    const { examJson } = normaliseScheme(mathsPaper(q));
    expect('scheme_shortfall' in examJson._layout).toBe(false);
  });

  test('normalising twice keeps one entry and one point', () => {
    const once = normaliseScheme(SCIENCE).examJson;
    const twice = normaliseScheme(once).examJson;
    expect(twice).toEqual(once);
  });

  test('comprehension sub-questions and objective items are left alone', () => {
    const exam = {
      _layout: layoutOf('english'),
      unseen: {
        objective: { mcqs: [{ slot: 'english.A.Q1a', question: 'Pick one', options: ['a', 'b', 'c', 'd'], answer: 'a', marks: 1, blooms: 'Remember' }] },
        subjective: {
          comprehension: [{
            slot: 'english.B.Q2',
            question: 'Read the passage.',
            passage: 'The farmer walked to the river.',
            marks: 20,
            blooms: 'Understand',
            parts: [{ key: 'questions', questions: [{ question: 'Where?', answer: 'To the river.' }] }],
          }],
        },
      },
    };
    const { examJson } = normaliseScheme(exam);
    expect(examJson.unseen.objective.mcqs[0].scheme).toBeUndefined();
    expect(examJson.unseen.subjective.comprehension[0].parts[0].questions[0].scheme).toBeUndefined();
    expect('scheme_shortfall' in examJson._layout).toBe(false);
  });
});
