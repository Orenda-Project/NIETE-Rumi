'use strict';
const M = require('../../../bot/shared/services/assessment/board-checks/maths-check-secondary');
const { recognise } = require('../../../bot/shared/services/assessment/board-checks/maths-recognisers');
const { mcq, srq, row, paper, ctxBoard, deepFreeze } = require('./paper-builder');

const P = (item) => paper({ sections: [{ id: 'B', marks: 4, slots: [row('s', { type: 'srq', marks_each: 4 })] }], items: [{ slot: 's', ...item }] });
const check = (q, a, code = 'maths') => M.run(P(srq('n', 's', 4, { question: q, answer: a })), ctxBoard({ subjectConfig: { code } }));
const ok = (q, a, code) => expect(check(q, a, code).issues).toEqual([]);
const bad = (q, a, code) => {
  const r = check(q, a, code);
  expect(r.issues).toHaveLength(1);
  expect(r.issues[0]).toMatchObject({ rule: 'MISMATCH', hard: true, item_ref: 's#1' });
  expect(r.ok).toBe(false);
};

describe('maths-check-secondary', () => {
  test('interface + LIMITS', () => {
    expect(M).toMatchObject({ id: 'maths-secondary', hard: true, modes: ['free', 'board'] });
    expect(M.LIMITS).toEqual({ relTol: 1e-6 });
  });

  test('linear_eq: Solve 3x + 5 = 20', () => {
    ok('Solve 3x + 5 = 20', 'x = 5');
    bad('Solve 3x + 5 = 20', 'x = 25/3');
    ok('Solve for x: 2x - 7 = 9', 'x = 8');
    ok('Solve 4x = 10', 'x = 2.5');
    bad('Solve -x + 1 = 4', 'x = 3');
    ok('Solve -x + 1 = 4', 'x = -3');
    ok('Solve 3x + 1 = 2', 'x = 0.33');
    bad('Solve 3x + 1 = 2', 'x = 0.4');
  });

  test('quad_roots: perfect square and surd form', () => {
    ok('Solve x² - 5x + 6 = 0', 'x = 2, x = 3');
    ok('Solve x^2 - 5x + 6 = 0', '3 and 2');
    bad('Solve x² - 5x + 6 = 0', 'x = 2, x = -3');
    ok('Solve x² - 2x - 2 = 0', 'x = 1 ± √3');
    bad('Solve x² - 2x - 2 = 0', 'x = 1 ± √2');
    ok('Solve x² - 4x + 4 = 0', 'x = 2');
    expect(check('Solve x² + x + 1 = 0', 'no real roots').issues).toEqual([]);
  });

  test('expand_binomial: Expand (x + 2)(x + 3)', () => {
    ok('Expand (x + 2)(x + 3)', 'x² + 5x + 6');
    bad('Expand (x + 2)(x + 3)', 'x² + 6x + 5');
    ok('Expand (x - 2)(x + 5)', 'x^2 + 3x - 10');
    bad('Expand (x - 2)(x + 5)', 'x² - 3x - 10');
  });

  test('surd_simplify: Simplify √50 and √a × √b', () => {
    ok('Simplify √50', '5√2');
    bad('Simplify √50', '2√5');
    bad('Simplify √50', '√50');
    ok('Simplify √18 × √2', '6');
    ok('Simplify √12', '2√3');
    ok('Simplify √7', '√7');
    ok('Simplify √50', '5 sqrt(2)');
  });

  test('trig_exact: sin 30° keyed 1/2', () => {
    ok('Find the exact value of sin 30°', '1/2');
    bad('Find the exact value of sin 30°', '√3/2');
    ok('Evaluate cos 45°', '1/√2');
    ok('What is tan 60°?', '√3');
    bad('What is tan 60°?', '1');
    ok('Evaluate sin 30° + cos 60°', '7'); // not a lone trig value: not recognised, passes
  });

  test('matrix_2x2: determinant, sum, product', () => {
    ok('Find the determinant of [[2,3],[1,4]]', '5');
    bad('Find the determinant of [[2,3],[1,4]]', '11');
    ok('Find the sum of [[1,2],[3,4]] and [[0,1],[1,0]]', '[[1,3],[4,4]]');
    bad('Find the sum of [[1,2],[3,4]] and [[0,1],[1,0]]', '[[1,3],[4,5]]');
    ok('Find the product of |1 2; 3 4| and |0 1; 1 0|', '[[2, 1], [4, 3]]');
    bad('Find the product of |1 2; 3 4| and |0 1; 1 0|', '[[0, 1], [3, 4]]');
    expect(check('Find the sum of [[1,2],[3,4]] and [[0,1],[1,0]]', 'the matrix is big').issues[0]).toMatchObject({ rule: 'UNPARSED', hard: false });
  });

  test('stoich_moles: moles from mass and mass from moles (chemistry)', () => {
    const q1 = 'How many moles are in 11 g of CO2? (M = 44 g mol⁻¹)';
    ok(q1, '0.25 mol', 'chemistry');
    bad(q1, '0.5 mol', 'chemistry');
    const q2 = 'Find the mass of 0.5 mol of water (molar mass 18 g/mol).';
    ok(q2, '9 g', 'chemistry');
    bad(q2, '36 g', 'chemistry');
    expect(check(q1, '0.5 mol', 'maths').issues).toEqual([]); // stoich not run for maths
  });

  test('unrecognised stem passes; unreadable key passes with soft UNPARSED', () => {
    ok('Explain why the sky is blue.', 'Rayleigh scattering');
    const r = check('Solve 3x + 5 = 20', 'the answer is five');
    expect(r.issues).toEqual([expect.objectContaining({ rule: 'UNPARSED', hard: false })]);
    expect(r.ok).toBe(true);
  });

  test('subject gating: english skips; free-mode papers without layout work; input frozen', () => {
    ok('Solve 3x + 5 = 20', 'x = 25/3', 'english');
    const free = { unseen: { subjective: { S: [{ id: 'a', type: 'srq', question: 'Solve 3x + 5 = 20', answer: 'x = 4' }] } } };
    expect(M.run(deepFreeze(free), deepFreeze({ mode: 'free', subjectConfig: { code: 'maths' } })).issues).toHaveLength(1);
  });

  test('MCQ: the keyed option is compared; unresolved key is left to D13', () => {
    const item = mcq('m', 's', 'B', ['A) x = 4', 'B) x = 5', 'C) x = 6', 'D) x = 7'], { question: 'Solve 3x + 5 = 20' });
    expect(M.run(P(item), ctxBoard({ subjectConfig: { code: 'maths' } })).issues).toEqual([]);
    expect(M.run(P({ ...item, answer: 'C' }), ctxBoard({ subjectConfig: { code: 'maths' } })).issues[0]).toMatchObject({ rule: 'MISMATCH' });
    expect(M.run(P({ ...item, answer: 'zz' }), ctxBoard({ subjectConfig: { code: 'maths' } })).issues).toEqual([]);
  });

  test('recognise() picks by subject', () => {
    expect(recognise('Solve 3x + 5 = 20', 'maths').id).toBe('linear_eq');
    expect(recognise('Solve 3x + 5 = 20', 'chemistry')).toBeNull();
    expect(recognise('Simplify √50', 'maths').expected).toEqual({ kind: 'surd', k: 5, m: 2 });
  });
});
