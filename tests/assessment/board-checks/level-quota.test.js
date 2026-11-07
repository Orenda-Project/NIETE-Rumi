'use strict';
// bd-5jmnfj.38.30 r9 (A6b, too much Knowledge): a per-slot level quota from the blueprint for the writer, and the
// items over it when the paper misses its split by more than the tolerance. Fictional papers only.
const LQ = require('../../../bot/shared/services/assessment/board-checks/_level-quota');
const B = require('../../../bot/shared/services/assessment/board-checks/blueprint-qa');
const { mcq, srq, row, paper, ctxBoard } = require('./paper-builder');

const KUA = { K: 30, U: 50, A: 20 };
const split = (o = {}) => ({ levels: KUA, tolerance_pp: 5, status: 'verified', ...o });

describe('quotaFor: counts per level for a slot, largest remainder, in blueprint order', () => {
  test('6 items at K30/U50/A20 -> K 2, U 3, A 1; 40 -> 12/20/8; 1 -> U 1', () => {
    expect(LQ.quotaFor(6, KUA)).toEqual({ K: 2, U: 3, A: 1 });
    expect(LQ.quotaFor(40, KUA)).toEqual({ K: 12, U: 20, A: 8 });
    expect(LQ.quotaFor(1, KUA)).toEqual({ K: 0, U: 1, A: 0 });
    expect(LQ.quotaFor(0, KUA)).toEqual({ K: 0, U: 0, A: 0 });
  });
  test('leftFor: the rewrite is told the levels its slot still lacks', () => {
    expect(LQ.leftFor({ K: 2, U: 3, A: 1 }, { K: 2, U: 1 }, 3)).toEqual({ K: 0, U: 2, A: 1 });
    expect(LQ.leftFor({ K: 2, U: 3, A: 1 }, { K: 4, U: 3, A: 1 }, 2)).toEqual({ K: 0, U: 1, A: 1 });
  });
});

describe('blueprint-qa LEVEL_OVER (hard) when the split misses by more than the tolerance', () => {
  const lvl = (b) => ({ chapter: 1, section: null, code: 'g9.x.ch1.lo1', page: 1, official_slo: null, blooms: b, difficulty: 'easy' });
  const mk = (levels) => {
    const items = levels.map((b, i) => srq(`s${i}`, 'B.Q2', 2, { tag: lvl(b) }));
    return paper({ sections: [{ id: 'B', marks: 12, slots: [row('B.Q2', { type: 'srq', attempt: 6, printed: 6, generate: 6, marks_each: 2 })] }], items });
  };
  const ctx = (s) => ctxBoard({ variant: { scheme_style: 'analytic_points', sections: [], cognitive_split: s } });
  const over = (r) => r.issues.filter((i) => i.rule === 'LEVEL_OVER');

  test('5 K of 6 (83% vs 30%) -> the last 3 K items over the slot quota of 2 are hard', () => {
    const r = B.run(mk(['K', 'K', 'U', 'K', 'K', 'K']), ctx(split()));
    expect(over(r).map((i) => [i.item_ref, i.hard, i.slot])).toEqual([['B.Q2#4', true, 'B.Q2'], ['B.Q2#5', true, 'B.Q2'], ['B.Q2#6', true, 'B.Q2']]);
    expect(over(r)[0].msg).toMatch(/K .* target 30%/);
    expect(r.ok).toBe(false);
  });
  test('on target (K 2, U 3, A 1) -> nothing; a default-status split is report-only', () => {
    expect(over(B.run(mk(['K', 'U', 'U', 'A', 'K', 'U']), ctx(split())))).toEqual([]);
    expect(over(B.run(mk(['K', 'K', 'K', 'K', 'K', 'K']), ctx(split({ status: 'default' }))))).toEqual([]);
  });
  test('within tolerance (K 33% vs 30%) -> nothing', () => {
    const r = B.run(mk(['K', 'K', 'U', 'U', 'U', 'A']), ctx(split()));
    expect(over(r)).toEqual([]);
  });
});

// bd-5jmnfj.38.33 (.38.32): a K excess that sits in stimulus MCQs must be capped too (the group itself is not rewritable,
// its members are). Fictional papers only.
describe('LEVEL_OVER reaches the members of stimulus groups', () => {
  const lvl = (b) => ({ chapter: 1, section: null, code: 'g11.x.ch2.lo1', page: 1, official_slo: null, blooms: b, difficulty: 'easy' });
  const kid = (id, b) => mcq(id, 'A.Q2', 'A', null, { tag: lvl(b), marks: 1 });
  const group = (id, bs) => ({ id, slot: 'A.Q2', type: 'scenario', stimulus: { id, kind: 'passage', text: 'A made-up passage.', items: bs.map((b, i) => kid(`${id}k${i}`, b)) } });
  const mk = (a, b) => paper({
    sections: [{ id: 'A', marks: 8, slots: [row('A.Q2', { type: 'scenario', attempt: 8, printed: 8, generate: 8, marks_each: 1 })] }],
    items: [group('g1', a), group('g2', b)],
  });
  const ctx = ctxBoard({ variant: { scheme_style: 'analytic_points', sections: [], cognitive_split: split() } });

  test('8 K stimulus MCQs at K30/U50/A20 -> quota K 2 of 8 (rounded 2.4), the last 6 are hard on their member refs (the writer drops the group and the rewrite is steered)', () => {
    const r = B.run(mk(['K', 'K', 'K', 'K'], ['K', 'K', 'K', 'K']), ctx);
    const over = r.issues.filter((i) => i.rule === 'LEVEL_OVER');
    expect(over.map((i) => i.item_ref)).toEqual(['A.Q2#1@s3', 'A.Q2#1@s4', 'A.Q2#2@s1', 'A.Q2#2@s2', 'A.Q2#2@s3', 'A.Q2#2@s4']);
    expect(over.every((i) => i.hard === true && i.slot === 'A.Q2')).toBe(true);
    expect(r.ok).toBe(false);
  });
  test('stimulus members on target -> nothing', () => {
    const r = B.run(mk(['K', 'U', 'U', 'A'], ['K', 'U', 'U', 'A']), ctx);
    expect(r.issues.filter((i) => i.rule === 'LEVEL_OVER')).toEqual([]);
  });
});
