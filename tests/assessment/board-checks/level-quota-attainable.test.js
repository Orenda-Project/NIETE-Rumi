'use strict';
// bd-5jmnfj.38.25.9 (PATTERN_SHORT_SLOT on prod, G11 Urdu e4750c59): D12's share target must be one the slot quotas
// can reach. FBISE Urdu/English papers are mostly single high-mark slots, and a 1-item slot's quota is always U, so a
// paper with EVERY slot exactly at its quota is already ~64% U against a 50% +/-5 target. The share trigger then never
// clears, the tolerance is gone, and one extra U item anywhere fails the paper closed. Fictional items, real shapes.
const LQ = require('../../../bot/shared/services/assessment/board-checks/_level-quota');
const B = require('../../../bot/shared/services/assessment/board-checks/blueprint-qa');
const Board = require('../../../bot/shared/services/assessment/patterns/board');
const { mcq, srq, row, paper, ctxBoard } = require('./paper-builder');

const lvl = (b) => ({ chapter: 2, section: null, code: 'g11.urdu.ch2.lo1', page: 12, official_slo: null, blooms: b, difficulty: 'easy' });
const urdu = Board.subjectOf('fbise_hssc1_2027', 'urdu').variants[0];
const split = urdu.cognitive_split;
const ctx = ctxBoard({ subjectConfig: { code: 'urdu' }, variant: { scheme_style: 'analytic_points', sections: [], cognitive_split: split } });
const over = (r) => r.issues.filter((i) => i.rule === 'LEVEL_OVER');

/** Every slot at exactly its quota (blueprint order), then `edit` may change the MCQ levels. */
function quotaPaper(edit = (x) => x) {
  const items = [];
  const sections = urdu.sections.map((s) => ({
    id: s.id,
    marks: s.slots.reduce((a, r) => a + r.attempt * r.marks_each, 0),
    slots: s.slots.map((r) => {
      const q = LQ.quotaFor(r.printed, split.levels);
      let levels = Object.entries(q).flatMap(([l, n]) => Array(n).fill(l));
      if (r.type === 'mcq') levels = edit(levels);
      levels.forEach((b, i) => {
        const id = `${r.slot}#${i + 1}`;
        items.push(r.type === 'mcq'
          ? mcq(id, r.slot, 'A) 1', null, { marks: r.marks_each, tag: lvl(b) })
          : srq(id, r.slot, r.marks_each, { type: r.type, tag: lvl(b) }));
      });
      return row(r.slot, { type: r.type, attempt: r.attempt, printed: r.printed, generate: r.printed, marks_each: r.marks_each });
    }),
  }));
  return paper({ sections, items });
}

describe('D12 on a pattern whose quotas cannot reach the split (G11 Urdu, FBISE 30/50/20 +/-5)', () => {
  test('the slot quotas themselves come to ~64% U: the tolerance is measured from there, not from 50%', () => {
    expect(over(B.run(quotaPaper(), ctx))).toEqual([]);
  });

  test('prod e4750c59: one MCQ written U instead of K (11 U of 20, quota 10) is within tolerance, not a hard fail', () => {
    const oneMoreU = (ls) => { const i = ls.indexOf('K'); const out = ls.slice(); out[i] = 'U'; return out; };
    const r = B.run(quotaPaper(oneMoreU), ctx);
    expect(over(r)).toEqual([]);
  });

  test('still hard when U runs past the reachable share by more than the tolerance (all 20 MCQs U, ~74% U)', () => {
    const r = B.run(quotaPaper((ls) => ls.map(() => 'U')), ctx);
    expect(over(r).length).toBeGreaterThan(0);
    expect(over(r).every((i) => i.hard && i.slot === '1.Q1')).toBe(true);
  });
});

describe('sciences keep the design target: their quotas already reach it', () => {
  test('G11 Physics slot quotas land within tolerance of 30/50/20, so attainable never replaces the target', () => {
    const v = Board.subjectOf('fbise_hssc1_2027', 'physics').variants[0];
    const cs = v.cognitive_split;
    const reach = LQ.attainable({ _layout: { sections: v.sections } }, cs.levels);
    Object.keys(cs.levels).forEach((l) => expect(reach[l] - cs.levels[l]).toBeLessThanOrEqual(cs.tolerance_pp));
  });
});
