'use strict';
// bd-qyi45h.10: prod G10 Maths 2869636c (13 Nov dry run) failed PATTERN_SHORT_SLOT on D16 alone. Both keys were right
// and stated two answers; D16 read only the key's last number, so the calc for the first answer read as a mismatch.
const M = require('../../../bot/shared/services/assessment/board-checks/numeric-resolve');
const { srq, row, paper, ctxBoard } = require('./paper-builder');

const num = (expr, answer, sig, unit = '') => srq('n', 's', 4, { kind: 'numerical', answer, calc: { expr, unit, sig } });
const run = (item) => M.run(paper({ sections: [{ id: 'B', marks: 4, slots: [row('s', { type: 'srq', marks_each: 4 })] }], items: [{ slot: 's', ...item }] }), ctxBoard());
const rules = (r) => r.issues.map((i) => i.rule);

const CRAMER = 'D = |4, 3; 1, 2| = 8 - 3 = 5.\nDx = |-6, 3; 1, 2| = -12 - 3 = -15.\nDy = |4, -6; 1, 1| = 4 - (-6) = 10.\n'
  + 'x = Dx / D = -15 / 5 = -3.\ny = Dy / D = 10 / 5 = 2.\nSolution: x = -3, y = 2.';
const GARDEN = 'Length = 24 feet, Width = 10 feet (or vice versa).';

describe('D16 reads every answer the key states on its final line', () => {
  test('Cramer: calc for x (-3) matches "x = -3, y = 2"', () => expect(run(num('(-15)/5', CRAMER, 1)).issues).toEqual([]));
  test('garden: calc 24 matches "Length = 24 feet, Width = 10 feet"', () => expect(rules(run(num('24', GARDEN, 2, 'feet')))).toEqual([]));
  test('a value the final line does not state is still a hard mismatch', () => {
    expect(rules(run(num('(-15)/5', 'x = -3.\nSolution: x = 4, y = 2.', 1)))).toEqual(['NUMERIC_MISMATCH']);
    expect(rules(run(num('25', GARDEN, 2, 'feet')))).toEqual(['NUMERIC_MISMATCH']);
  });
  test('an intermediate value from an earlier line does not rescue a wrong final answer', () => {
    expect(rules(run(num('(-15)/5', 'x = -15 / 5 = -3.\nSolution: x = 4, y = 2.', 1)))).toEqual(['NUMERIC_MISMATCH']);
  });
  test('an operand on the final line is not an answer: 12*15 vs "12 x 15 = Rs 108"', () => {
    expect(rules(run(num('15', '12 x 15 = Rs 108', 3, 'Rs')))).toEqual(['NUMERIC_MISMATCH']);
  });
});
