/**
 * v28 G2 Maths common-error notes gave a wrong diagnosis (bd-5jmnfj.4.58.4):
 *   Q8 iv 703 - 248 said "giving 565"; the smaller digit taken from the larger in each place gives 545.
 *   Q9 640 - 275 said "giving 475 marbles"; the same slip gives 435.
 *   Q8 i 78 - 35 and Q6 i-style sums name a slip no column can produce (no column regroups): the note is dropped.
 * Pure: {examJson, notes}.
 */

const { commonErrorNumbers } = require('../../bot/shared/services/assessment/fde-common-error-numbers');
const g2 = require('../../bot/shared/services/assessment/patterns/early/g2-maths');

const paper = (type, items) => ({ unseen: { subjective: { [type]: items } }, _layout: { sections: [] } });
const fix = (type, item) => commonErrorNumbers(paper(type, [item])).examJson.unseen.subjective[type][0];
const item = (question, answer, common_error) => ({ slot: 'g2.maths.B.Q8', question, answer, marks: 1, scheme: { points: [], common_error } });

describe('subtraction: the figure is what the slip gives', () => {
  test('G2 Maths Q8 iv 703 - 248: "giving 565" becomes 545', () => {
    const q = fix('Subtraction', item('703 - 248 = ?', '455', 'Writing 0 - 4 as 4 instead of borrowing, giving 565'));
    expect(q.scheme.common_error).toBe('Writing 0 - 4 as 4 instead of borrowing, giving 545');
  });

  test('G2 Maths Q9 640 - 275: "giving 475 marbles" becomes 435', () => {
    const q = fix('Subtraction Word Problem', item('Babloo had 640 marbles. He gave 275 marbles away. How many now?', '640 - 275 = 365 marbles', 'Not regrouping and subtracting the smaller digit from the larger, giving 475 marbles'));
    expect(q.scheme.common_error).toBe('Not regrouping and subtracting the smaller digit from the larger, giving 435 marbles');
  });

  test('a figure the slip does give is left alone (62 - 27 writing 45)', () => {
    const e = 'Subtracting 2 from 7 the wrong way round, writing 45';
    expect(fix('Subtraction', item('62 - 27 = ?', '35', e)).scheme.common_error).toBe(e);
  });

  test('G2 Maths Q8 i 78 - 35: no column regroups, so the smaller-from-larger note is dropped', () => {
    const q = fix('Subtraction', item('78 - 35 = ?', '43', 'Subtracting smaller digit from larger in wrong places'));
    expect('common_error' in q.scheme).toBe(false);
  });

  test('a note with no figure that can occur is kept when a column does regroup', () => {
    const e = 'Subtracting the smaller digit from the larger in each place';
    expect(fix('Subtraction', item('62 - 27 = ?', '35', e)).scheme.common_error).toBe(e);
  });

  test('a note about another slip is untouched', () => {
    const e = 'Adding instead of subtracting, writing 113';
    expect(fix('Subtraction', item('78 - 35 = ?', '43', e)).scheme.common_error).toBe(e);
  });
});

describe('addition: a forgot-to-carry note needs a column that carries', () => {
  test('34 + 25 carries nowhere: the no-carry note is dropped', () => {
    const q = fix('Addition', item('34 + 25 = ?', '59', 'Forgetting to carry, writing 49'));
    expect('common_error' in q.scheme).toBe(false);
  });

  test('47 + 38 carries the ones: the note stays', () => {
    const e = 'Forgetting to carry the ten, writing 75';
    expect(fix('Addition', item('47 + 38 = ?', '85', e)).scheme.common_error).toBe(e);
  });
});

test('notes say what changed; an item without a scheme or a paper without items is returned as it was', () => {
  const { notes } = commonErrorNumbers(paper('Subtraction', [item('703 - 248 = ?', '455', 'Writing 0 - 4 as 4 instead of borrowing, giving 565')]));
  expect(notes).toHaveLength(1);
  expect(commonErrorNumbers(null).examJson).toBe(null);
  const bare = { slot: 'g2.maths.B.Q8', question: '78 - 35' };
  expect(fix('Subtraction', bare)).toEqual(bare);
});

describe('prompt rule on the subtraction and addition slots', () => {
  test.each(['g2.maths.B.Q6', 'g2.maths.B.Q8'])('%s: a common error is one the numbers can produce, with the number it gives', (id) => {
    const rule = g2.sections.flatMap((s) => s.slots).find((s) => s.slot === id).prompt_rule;
    expect(rule).toMatch(/common error[^.]*(can produce|can happen)/i);
    expect(rule).toMatch(/number (that|the) (mistake|slip|error) gives/i);
  });
});
