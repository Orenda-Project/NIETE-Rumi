'use strict';
/**
 * bd-qyi45h.1 option (c): D12 stays hard, and every run of the level-mix check can be logged as one line: each
 * level's marks share against its target and its reachable share, the tolerance, and whether it passed. Also the
 * checks record names the hard rules (check + rule code), so a failed paper says why without a BigQuery dig.
 */
const A = '../../../bot/shared/services/assessment/';
const { levelShares } = require(`${A}board-checks/_level-quota`);
const { makeRun } = require(`${A}board-checks`);

const SPLIT = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5, status: 'verified' };

/** A two-slot paper: Q1 4 one-mark items, Q2 1 four-mark item; blooms given per leaf. */
function paper(q1, q2) {
  const rows = [{ slot: 'Q1', section: 'A', generate: 4, printed: 4, marks_each: 1 }, { slot: 'Q2', section: 'A', generate: 1, printed: 1, marks_each: 4 }];
  return {
    unseen: {
      objective: { mcq: q1.map((b, i) => ({ id: `Q1#${i + 1}`, slot: 'Q1', question: `made-up ${i + 1}`, marks: 1, tag: { blooms: b } })) },
      subjective: { erq: [{ id: 'Q2#1', slot: 'Q2', question: 'made-up long', marks: 4, tag: { blooms: q2 } }] },
    },
    _layout: { slots: rows, sections: [{ id: 'A', slots: rows }] },
  };
}

describe('levelShares', () => {
  test('null without a split', () => {
    expect(levelShares(paper(['K', 'K', 'U', 'A'], 'U'), null)).toBeNull();
  });

  test('per level: have, target and reach (rounded to 0.1), the tolerance, status and pass', () => {
    const got = levelShares(paper(['K', 'K', 'U', 'A'], 'U'), SPLIT);
    expect(got.tolerance_pp).toBe(5);
    expect(got.status).toBe('verified');
    expect(Object.keys(got.levels).sort()).toEqual(['A', 'K', 'U']);
    expect(got.levels.U.target).toBe(50);
    expect(typeof got.levels.U.have).toBe('number');
    expect(typeof got.levels.U.reach).toBe('number');
    expect(typeof got.pass).toBe('boolean');
  });

  test('pass is false exactly when overQuota has a LEVEL_OVER', () => {
    // 8 marks: K 3/8 = 37.5% is over 30+5 and Q1 has 3 K items against a K quota of 1
    const over = levelShares(paper(['K', 'K', 'K', 'U'], 'U'), SPLIT);
    expect(over.pass).toBe(false);
    expect(over.levels.K.have).toBe(37.5);
  });

  test('a report-only split is reported with pass true', () => {
    const got = levelShares(paper(['K', 'K', 'K', 'K'], 'K'), { ...SPLIT, status: 'design_pending' });
    expect(got.pass).toBe(true);
    expect(got.status).toBe('design_pending');
  });

  test('the line carries no person ids', () => {
    const got = levelShares(paper(['K', 'U', 'U', 'A'], 'U'), SPLIT);
    expect(JSON.stringify(got)).not.toMatch(/user|phone|teacher|cnic/i);
  });

  test('reach comes from the slot quotas: Q2 is one 4-mark item, so its whole 4 marks sit at its top level', () => {
    // quotaFor(4) = K1 U2 A1 on Q1 (1 mark each), quotaFor(1) = U1 on Q2 (4 marks): U reaches 6/8 = 75%
    const got = levelShares(paper(['K', 'U', 'U', 'A'], 'U'), SPLIT);
    expect(got.levels.U.reach).toBe(75);
    expect(got.levels.K.reach).toBe(12.5);
  });
});

describe('the checks record names its hard rules', () => {
  const member = (issues) => ({ id: 'D99', name: 'fake-check', modes: ['board'], run: () => ({ issues }) });
  const ex = { sections: [{ id: 'A', questions: [{ id: 'Q1#1', slot: 'Q1', question: 'x', marks: 1 }] }] };

  test('hard_rules counts each hard issue by check and rule', () => {
    const run = makeRun([member([
      { check: 'D12', rule: 'LEVEL_OVER', item_ref: 'Q1', msg: 'm', hard: true },
      { check: 'D12', rule: 'LEVEL_OVER', item_ref: 'Q1', msg: 'm', hard: true },
      { check: 'D16', rule: 'KEY_LEAK', item_ref: 'Q1', msg: 'm', hard: true },
      { check: 'D20', rule: 'SOFT_ONE', item_ref: 'Q1', msg: 'm', hard: false },
    ])]);
    expect(run(ex, { mode: 'board' }).record.hard_rules).toEqual({ 'D12 LEVEL_OVER': 2, 'D16 KEY_LEAK': 1 });
  });

  test('an issue built by _text-norm (rule under `code`, e.g. N18 KEY_IN_STEM) is named, not "?" (bd-qyi45h.4)', () => {
    const run = makeRun([member([{ check: 'N18', code: 'KEY_IN_STEM', item_ref: 'Q1', msg: 'm', hard: true }])]);
    expect(run(ex, { mode: 'board' }).record.hard_rules).toEqual({ 'N18 KEY_IN_STEM': 1 });
  });

  test('no hard issue, no hard_rules key', () => {
    expect(makeRun([member([])])(ex, { mode: 'board' }).record).not.toHaveProperty('hard_rules');
  });
});
