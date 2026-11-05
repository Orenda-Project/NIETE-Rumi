'use strict';
const M = require('../../../bot/shared/services/assessment/board-checks/numeric-resolve');
const { mcq, srq, row, paper, ctxBoard, deepFreeze } = require('./paper-builder');

const num = (expr, answer, sig = 3, unit = 'Rs', extra = {}) => srq('n', 's', 4, { kind: 'numerical', answer, calc: { expr, unit, sig }, ...extra });
const run = (item, ctx) => M.run(paper({ sections: [{ id: 'B', marks: 4, slots: [row('s', { type: 'srq', marks_each: 4 })] }], items: [{ slot: 's', ...item }] }), ctx || ctxBoard());
const rules = (r) => r.issues.map((i) => i.rule);

describe('D16 numeric-resolve', () => {
  test('interface + LIMITS', () => {
    expect(M).toMatchObject({ id: 'D16', hard: true, modes: ['free', 'board'] });
    expect(M.LIMITS).toEqual({ defaultSig: 3 });
  });

  test('(1) 12*15 vs Rs 180 ok; Rs 108 hard; frozen input', () => {
    const ok = M.run(deepFreeze(paper({ sections: [{ id: 'B', marks: 4, slots: [row('s', { type: 'srq', marks_each: 4 })] }], items: [num('12*15', '12 x 15 = Rs 180')].map((i) => ({ slot: 's', ...i })) })), deepFreeze(ctxBoard()));
    expect(ok.issues).toEqual([]);
    const bad = run(num('12*15', 'Rs 108'));
    expect(bad.issues[0]).toMatchObject({ rule: 'NUMERIC_MISMATCH', hard: true, item_ref: 's#1' });
    expect(bad.ok).toBe(false);
  });

  test('(2) 240/8 sig 2 vs 30', () => expect(run(num('240/8', '240 / 8 = 30 minutes', 2, 'min')).issues).toEqual([]));

  test('(3) 24.5/122.5 sig 3 vs 0.200; vs 0.201 ok at sig 2 only', () => {
    expect(run(num('24.5/122.5', '0.200', 3, '')).issues).toEqual([]);
    expect(rules(run(num('24.5/122.5', '0.201', 3, '')))).toEqual(['NUMERIC_MISMATCH']);
    expect(run(num('24.5/122.5', '0.201', 2, '')).issues).toEqual([]);
  });

  test('(4) sqrt(2)*3 sig 3 vs 4.24; pi, ^, parens, unary minus', () => {
    expect(run(num('sqrt(2)*3', '4.24', 3, '')).issues).toEqual([]);
    expect(run(num('pi*2^2', '12.6', 3, 'cm2')).issues).toEqual([expect.objectContaining({ rule: 'UNIT_MISSING', hard: false })]);
    expect(run(num('(1+2)*-3', '-9', 3, '')).issues).toEqual([]);
    expect(run(num('-2^2', '-4', 3, '')).issues).toEqual([]);
    expect(run(num('2^3^2', '512', 3, '')).issues).toEqual([]);
  });

  test('(5) injection / junk expr -> soft UNRESOLVED, no throw', () => {
    for (const e of ['12*15; drop table', 'process.exit()', '1/0', '2**3', '', '(1+2', 'sqrt(-1)', 'alert(1)']) {
      const r = run(num(e, '180'));
      expect(rules(r)).toEqual(['UNRESOLVED']);
      expect(r.issues[0].hard).toBe(false);
      expect(r.ok).toBe(true);
    }
  });

  test('(6) numerical item with no calc -> soft UNRESOLVED; non-numerical ignored', () => {
    const r = run(srq('n', 's', 4, { kind: 'numerical', answer: '5' }));
    expect(r.issues).toEqual([expect.objectContaining({ rule: 'UNRESOLVED', hard: false })]);
    expect(run({ ...srq('n', 's', 4, { kind: 'numerical', answer: '5' }), kind: 'define', type: 'srq' }).issues).toEqual([]);
    expect(run({ id: 't', type: 'numerical', question: 'q', answer: '5' }).issues).toHaveLength(1);
  });

  test('(7) key "Rs 1,80" is unparseable -> soft; thousands comma ok', () => {
    expect(rules(run(num('12*15', 'Rs 1,80')))).toEqual(['UNRESOLVED']);
    expect(run(num('1200', 'Rs 1,200')).issues).toEqual([]);
    expect(rules(run(num('12*15', 'no number here')))).toEqual(['UNRESOLVED']);
  });

  test('(8) MCQ numerical: key on option C', () => {
    const item = mcq('m', 's', 'C', ['A) 6', 'B) 12', 'C) Rs 180', 'D) 24'], { kind: 'numerical', calc: { expr: '12*15', unit: 'Rs', sig: 3 } });
    expect(run(item).issues).toEqual([]);
    expect(rules(run({ ...item, answer: 'B' }))).toContain('NUMERIC_MISMATCH');
    expect(rules(run({ ...item, answer: 'zzz' }))).toEqual(['UNRESOLVED']);
  });

  test('UNIT_MISSING soft when the key omits the unit; fractions in the key', () => {
    const r = run(num('240/8', '30', 2, 'min'));
    expect(r.issues).toEqual([expect.objectContaining({ rule: 'UNIT_MISSING', hard: false })]);
    expect(run(num('3/4', '3/4', 3, '')).issues).toEqual([]);
  });

  test('free mode works without layout; default sig applies when calc.sig is absent', () => {
    const free = { unseen: { subjective: { S: [{ id: 'a', type: 'srq', kind: 'numerical', answer: '0.333', calc: { expr: '1/3' } }] } } };
    expect(M.run(free, { mode: 'free' }).issues).toEqual([]);
  });
});
