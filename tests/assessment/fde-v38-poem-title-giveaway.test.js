'use strict';
const { dropTitleGiveaway } = require('../../bot/shared/services/assessment/fde-poem-title-giveaway');

const poem = (points, passage = 'ندی کی فریاد\nیہ گندگی ہے کیسی آئی ہے یہ کہاں سے؟') => ({ unseen: { subjective: { 'Poem Explanation': [{ slot: 'urdu.C.Q6', passage, marks: 5, scheme: { points: points.map(([text, marks]) => ({ text, marks, kind: 'A' })), accept: ['x'], common_error: 'y', checked: null } }] } } });
const pts = (r) => r.examJson.unseen.subjective['Poem Explanation'][0].scheme.points;

describe('dropTitleGiveaway: no mark for what the printed title states', () => {
  test('«بولنے والا ندی ہے» under the title «ندی کی فریاد» is dropped and its marks move to the largest point', () => {
    const r = dropTitleGiveaway(poem([['بولنے والا ندی ہے', 1.5], ['اپنے لفظوں میں', 1.5], ['مسئلہ: شہر کی گندگی سے ندی کا آلودہ ہونا', 1], ['ندی کی تکلیف اور بے بسی کا احساس', 1]]));
    expect(pts(r).map((p) => p.text)).not.toContain('بولنے والا ندی ہے');
    expect(pts(r).reduce((s, p) => s + p.marks, 0)).toBe(5);
    expect(r.notes.join(' ')).toMatch(/بولنے والا/);
  });
  test('a point that says more than the title is kept', () => {
    const p = poem([['ندی کی تکلیف اور بے بسی کا احساس', 3], ['اپنے لفظوں میں', 2]]);
    expect(dropTitleGiveaway(p).examJson).toEqual(p);
  });
  test('a passage with no title line is untouched', () => {
    const p = poem([['بولنے والا ندی ہے', 2], ['اپنے لفظوں میں', 3]], 'یہ گندگی ہے کیسی آئی ہے');
    expect(dropTitleGiveaway(p).examJson).toEqual(p);
  });
  test('the total is whole after re-weighting and the input is not mutated', () => {
    const p = poem([['بولنے والا ندی ہے', 1.5], ['اپنے لفظوں میں', 3.5]]);
    const copy = JSON.parse(JSON.stringify(p));
    const r = dropTitleGiveaway(p);
    expect(pts(r)).toHaveLength(1);
    expect(pts(r)[0].marks).toBe(5);
    expect(p).toEqual(copy);
  });
});
