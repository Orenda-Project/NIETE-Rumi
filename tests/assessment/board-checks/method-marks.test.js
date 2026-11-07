'use strict';
// D22 method-marks (Amena, 7 Nov 2026: "yes" to method marks for SSC/HSSC science numericals; no fixed split given).
// A numerical constructed item's scheme must carry a method/working point apart from its final-answer point.
// Fictional items only.
const M = require('../../../bot/shared/services/assessment/board-checks/method-marks');
const { srq, row, paper, ctxBoard } = require('./paper-builder');

const pts = (...list) => ({ points: list.map(([text, marks]) => ({ text, marks })) });
const make = (...items) => paper({ sections: [{ id: 'B', marks: 10, slots: [row('B.Q2', { type: 'srq', attempt: 3, printed: 3, marks_each: 2 })] }], items });
const ctx = (code = 'physics', style = 'analytic_points') => ctxBoard({ subjectConfig: { code }, variant: { scheme_style: style, sections: [] } });
const numerical = (id, scheme, extra = {}) => srq(id, 'B.Q2', 2, { question: 'A cart covers 100 m in 5 s. Find its speed.', answer: 'v = d/t = 100/5 = 20 m/s', scheme, ...extra });
const rules = (r) => r.issues.map((i) => [i.rule, i.item_ref, i.hard]);

describe('D22 method-marks', () => {
  test('interface: hard, board mode only', () => {
    expect(M).toMatchObject({ id: 'D22', name: 'method-marks', hard: true, modes: ['board'] });
  });
  test('a physics numerical whose scheme is one final-answer point -> ANSWER_ONLY, hard', () => {
    const r = M.run(make(numerical('n1', pts(['20 m/s', 2]))), ctx());
    expect(rules(r)).toEqual([['ANSWER_ONLY', 'B.Q2#1', true]]);
    expect(r.ok).toBe(false);
  });
  test('method point (formula and substitution) apart from the answer point -> clean', () => {
    const r = M.run(make(numerical('n1', pts(['v = d/t; v = 100/5', 1], ['20 m/s', 1]))), ctx());
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });
  test('two points that both only state the final value are still answer-only', () => {
    const r = M.run(make(numerical('n1', pts(['v = 20', 1], ['20 m/s', 1]))), ctx());
    expect(rules(r)).toEqual([['ANSWER_ONLY', 'B.Q2#1', true]]);
  });
  test('found by calc, by kind numerical, or by a number with a unit in the answer', () => {
    const one = pts(['answer', 2]);
    const byCalc = numerical('a', one, { answer: 'twenty', calc: { expr: '100/5', unit: 'm/s', sig: 2 } });
    const byKind = numerical('b', one, { answer: 'twenty', kind: 'numerical' });
    const byUnit = numerical('c', one, { answer: 'The current is 0.5 A.' });
    expect(M.run(make(byCalc, byKind, byUnit), ctx()).issues.map((i) => i.item_ref)).toEqual(['B.Q2#1', 'B.Q2#2', 'B.Q2#3']);
  });
  test('a non-numerical answer (no calc, no number with a unit) is not checked', () => {
    const r = M.run(make(numerical('n1', pts(['states the law', 2]), { question: 'State the first law of motion.', answer: 'A body stays at rest or moves uniformly unless a force acts.' })), ctx());
    expect(r.issues).toEqual([]);
  });
  test('chemistry and biology are checked; maths, english and a missing subject are not', () => {
    const p = () => make(numerical('n1', pts(['20 m/s', 2])));
    expect(M.run(p(), ctx('chemistry')).issues).toHaveLength(1);
    expect(M.run(p(), ctx('biology')).issues).toHaveLength(1);
    expect(M.run(p(), ctx('maths')).issues).toEqual([]);
    expect(M.run(p(), ctx('english')).issues).toEqual([]);
    expect(M.run(p(), {}).issues).toEqual([]);
  });
  test('a 1-mark item, an MCQ, an item with no points (D14 owns that) and a holistic_bands paper are not checked', () => {
    const oneMark = numerical('a', pts(['20 m/s', 1]), { marks: 1 });
    const noPts = numerical('b', { bands: [{ hi: 2, lo: 0, descriptor: 'x' }] });
    const choice = numerical('c', pts(['20 m/s', 2]), { type: 'mcq', options: ['A) 10 m/s', 'B) 20 m/s', 'C) 30 m/s', 'D) 40 m/s'] });
    expect(M.run(make(oneMark, noPts, choice), ctx()).issues).toEqual([]);
    expect(M.run(make(numerical('d', pts(['20 m/s', 2]))), ctx('physics', 'holistic_bands')).issues).toEqual([]);
  });
  test('a numerical part of a long question is checked on its own', () => {
    const long = srq('L', 'B.Q2', 5, { type: 'erq', parts: [
      srq('L.a', 'B.Q2', 2, { question: 'Define speed.', answer: 'distance per unit time', scheme: pts(['definition', 2]) }),
      srq('L.b', 'B.Q2', 3, { question: 'Find the speed for 60 m in 3 s.', answer: '20 m/s', scheme: pts(['20 m/s', 3]) }),
    ] });
    expect(rules(M.run(make(long), ctx()))).toEqual([['ANSWER_ONLY', 'B.Q2#1.p2', true]]);
  });
});
