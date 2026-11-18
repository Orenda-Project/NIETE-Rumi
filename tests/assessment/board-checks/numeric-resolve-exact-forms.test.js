'use strict';
// bd-qyi45h.10: prod G9 Maths ch6 e2c9d814 (13 Nov dry run) failed on D16 NUMERIC_MISMATCH x2-x5 with right keys
// written exactly: in pi ("5π inches"), in surds ("12 + 4√3 m") or as degrees-minutes-seconds ("60° 7' 30\"").
const M = require('../../../bot/shared/services/assessment/board-checks/numeric-resolve');
const { srq, row, paper, ctxBoard } = require('./paper-builder');

const num = (expr, answer, sig = 3, unit = '') => srq('n', 's', 4, { kind: 'numerical', answer, calc: { expr, unit, sig } });
const run = (item) => M.run(paper({ sections: [{ id: 'B', marks: 4, slots: [row('s', { type: 'srq', marks_each: 4 })] }], items: [{ slot: 's', ...item }] }), ctxBoard());
const hard = (r) => r.issues.filter((i) => i.hard).map((i) => i.rule);
const rules = (r) => r.issues.map((i) => i.rule);

describe('D16 reads a key written in pi or surds', () => {
  test('"5π inches" is 15.7', () => expect(hard(run(num('30 * (30 * pi / 180)', '5π inches', 3, 'inches')))).toEqual([]));
  test('"121π/360 radians" is 1.06', () => expect(hard(run(num('(60.5 * pi) / 180', '121π/360 radians', 3, 'radians')))).toEqual([]));
  test('"π/2" is 1.57', () => expect(hard(run(num('90 * pi / 180', 'π/2', 3)))).toEqual([]));
  test('"12 + 4√3 m" after "=" on a two-answer line is 18.9', () => {
    expect(hard(run(num('12 + 12/sqrt(3)', 'Horizontal distance = 12 m, Height of building = 12 + 4√3 m', 3, 'm')))).toEqual([]);
  });
  test('a wrong exact form is still a hard mismatch', () => {
    expect(hard(run(num('30 * (30 * pi / 180)', '6π inches', 3, 'inches')))).toEqual(['NUMERIC_MISMATCH']);
    expect(hard(run(num('12 + 12/sqrt(3)', 'Height = 12 + 2√3 m', 3, 'm')))).toEqual(['NUMERIC_MISMATCH']);
  });
});

describe('a degrees-minutes-seconds key is not one number', () => {
  test('"60° 7\' 30\\"" is soft UNRESOLVED, never a hard mismatch', () => {
    const r = run(num('60 + 0.125 * 60', '60° 7\' 30"', 4));
    expect(hard(r)).toEqual([]);
    expect(rules(r)).toEqual(['UNRESOLVED']);
  });
  test('a plain degree answer is still checked', () => {
    expect(hard(run(num('180 - 65', '115°', 3)))).toEqual([]);
    expect(hard(run(num('180 - 65', '125°', 3)))).toEqual(['NUMERIC_MISMATCH']);
  });
});

describe('a power-of-ten key is a number, not a unit power', () => {
  // bd-qyi45h.14: G11 Physics B.Q1-Q7#6/b, key "approximately 10^22 operations", read as 10
  test('"10^22" and "1.5 × 10^-3 m" are read whole', () => {
    expect(hard(run(num('10^22', 'Number of operations = 10^5 s / 10^-17 s = 10^22 operations.\nA supercomputer can perform approximately 10^22 operations in one day.', 1)))).toEqual([]);
    expect(hard(run(num('3 / 2000', 'd = 1.5 × 10^-3 m', 2, 'm')))).toEqual([]);
  });
  test('a wrong power of ten is still a hard mismatch; m/s^2 is still a unit', () => {
    expect(hard(run(num('10^22', 'about 10^21 operations', 1)))).toEqual(['NUMERIC_MISMATCH']);
    expect(hard(run(num('(16-4)/3', '4 m/s^2', 1, 'm/s^2')))).toEqual([]);
  });
});

describe('exact forms written in letters or LaTeX, and stated alternatives', () => {
  // bd-qyi45h.10: e2c9d814 out4 dry run (13 Nov) — right keys read as 6, 40, 5, 0 and 72
  test('"11pi/6 radians", "40/sqrt(pi) cm", "5 pi inches" are read through pi and sqrt', () => {
    expect(hard(run(num('330 * pi / 180', '11pi/6 radians', 3, 'radians')))).toEqual([]);
    expect(hard(run(num('sqrt(200*2/(pi/4))', '40/sqrt(pi) cm', 3, 'cm')))).toEqual([]);
    expect(hard(run(num('30 * pi / 6', '5 pi inches', 3, 'inches')))).toEqual([]);
  });
  test('"22.92 m (or 72/π m)" in LaTeX states both answers', () => {
    const key = 'The radius of the circle is $22.92 \\text{ m}$ (or $\\frac{72}{\\pi} \\text{ m}$).';
    expect(hard(run(num('6 / (15 * 3.14159 / 180)', key, 4, 'm')))).toEqual([]);
  });
  test('a wrong letter-written exact form is still hard', () => {
    expect(hard(run(num('30 * pi / 6', '6 pi inches', 3, 'inches')))).toEqual(['NUMERIC_MISMATCH']);
    expect(hard(run(num('6 / (15 * 3.14159 / 180)', 'The radius is $25 \\text{ m}$ (or $\\frac{80}{\\pi} \\text{ m}$).', 4, 'm')))).toEqual(['NUMERIC_MISMATCH']);
  });
  test('degrees written ^o or ^\\circ in a DMS key are soft UNRESOLVED', () => {
    expect(rules(run(num('255 + 0.45*60', '255^o 27\' 0"', 5)))).toEqual(['UNRESOLVED']);
    expect(rules(run(num('255 + 0.45*60', '$255^\\circ 27\' 0"$', 5)))).toEqual(['UNRESOLVED']);
  });
});
