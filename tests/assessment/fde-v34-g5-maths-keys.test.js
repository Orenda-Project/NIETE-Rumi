/**
 * G5 Maths key fixes from the v29 review (bd-5jmnfj.4.58 round 4), run on the real v29 items.
 */
const { mathsKeys } = require('../../bot/shared/services/assessment/fde-maths-keys');
const exam = require('./fixtures/fde-v34-g5-maths-v29.json');

const items = [];
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === 'object') { if (o.slot && 'question' in o) items.push(o); else Object.values(o).forEach(walk); }
}(exam.unseen));
const find = (re) => items.find((q) => re.test(q.question));
const run = (re) => { const notes = []; const q = find(re); return { q, out: mathsKeys(q, notes), notes }; };
const NO_WORKING = 'A correct answer with no working still earns the answer mark(s); the working mark is only for steps shown.';
const total = (q) => q.scheme.points.reduce((s, p) => s + p.marks, 0);

describe('G5 Maths keys, v29 review', () => {
  test('Q2 vii: the common error names the slip that gives the stated order', () => {
    const { out } = run(/Arrange the lengths from the shortest/);
    expect(out.scheme.common_error).toMatch(/numerators/);
    expect(out.scheme.common_error).toMatch(/2\/3 m is placed as the shortest/);
    expect(out.scheme.common_error).not.toMatch(/3\/4 m is placed as the shortest/);
  });

  test('Q2 vii: a common error that already gives the order is kept', () => {
    const q = { slot: 'maths.B.Q2', question: 'Arrange 1/2, 1/3 and 1/4 from the smallest to the greatest.', scheme: { points: [], accept: [], common_error: 'Compares only the denominators, so 1/2 is placed as the smallest.' } };
    expect(mathsKeys(q, [])).toBe(q);
  });

  test('Q2 iv: the accept line no longer allows methods the stem excludes', () => {
    const { out } = run(/Using the division method/);
    expect(out.scheme.accept.join(' ')).not.toMatch(/Prime factori|Listing common multiples/);
  });

  test('Q2 ii: count-up is not accepted for the vertical method; the vertical methods stay', () => {
    const { q, out } = run(/using the vertical method/);
    expect(out.scheme.accept.join(' ')).not.toMatch(/Count-up/);
    // v37 round 7 (bd-5jmnfj.4.58): every key that pays working now ends with the one no-working line; the vertical methods are still the only methods listed.
    expect(out.scheme.accept).toEqual(['Vertical subtraction with borrowing', 'Column subtraction with regrouping', NO_WORKING]);
    expect(out.scheme.points).toEqual(q.scheme.points);
  });

  test('Q7 and Q8: the unit mark is its own U1 point and the total holds', () => {
    ['average amount of rice', 'Find the other angle'].forEach((frag) => {
      const q = items.find((x) => x.question.includes(frag));
      const out = mathsKeys(q, []);
      expect(out.scheme.points.filter((p) => p.kind === 'U')).toHaveLength(1);
      expect(out.scheme.points.find((p) => p.kind === 'U').marks).toBe(1);
      expect(out.scheme.points.map((p) => p.text).join(' ')).not.toMatch(/\(Correct unit chosen/);
      expect(total(out)).toBe(total(q));
    });
  });

  test('Q5 and Q6 already have a U1 point and are untouched', () => {
    const q = find(/perimeter/);
    const out = mathsKeys(q, []);
    // v37 round 7 (bd-5jmnfj.4.58): the key pays method marks, so the one no-working line is appended to accept; the points, the U1 point and the total are untouched.
    expect(out.scheme.points).toEqual(q.scheme.points);
    expect(out.scheme.accept).toEqual([...q.scheme.accept, NO_WORKING]);
    expect(out.scheme.points.filter((p) => p.kind === 'U')).toHaveLength(1);
  });

  test('items it does not know pass through; null passes', () => {
    const q = { slot: 'maths.A.Q1b', question: 'Add 2 and 3.', scheme: { points: [{ text: 'x', marks: 1, kind: 'A' }], accept: [] } };
    expect(mathsKeys(q, [])).toBe(q);
    expect(mathsKeys(null, [])).toBe(null);
  });
});
