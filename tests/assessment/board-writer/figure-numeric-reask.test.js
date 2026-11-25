'use strict';
/**
 * bd-qyi45h.18: G9 board papers on NIETE prod, 18-24 Nov 2026, failed 11 of 67 in slot A.Q41-60 (passage groups).
 * 5 of the 11 still held an N20 FIGURE_REF (a question pointing at a figure the paper never prints) and 2 a D16
 * NUMERIC_MISMATCH (the key is not what its own working gives) after rewrite 1. Rewrites 3-5 re-asked only review
 * faults, key leaks, D17, D18 and D13, and neither N20 nor D16 is a last-try note, so the paper failed
 * PATTERN_SHORT_SLOT. The re-ask loop now takes an N20 or D16 item too, told why. Both rules stay hard.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const GF = require(`${A}board-6-12/group-faults`);
const SP = require(`${A}board-6-12/section-prompt`);
const LT = require(`${A}board-6-12/last-try`);
const { writeBoardPaper } = require(`${A}board-writer`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const { makeDeps, buildReply } = require('./helpers/fake-deps');
const { mcq, row: slotRow, paper } = require('../board-checks/paper-builder');

const withGroup = () => {
  const ex = paper({ sections: [{ id: 'A', marks: 3, slots: [slotRow('A.Q1', { attempt: 3, printed: 3, generate: 3 })] }], items: [mcq('A.Q1#1', 'A.Q1', 'A) 1')] });
  ex.unseen.objective.mcq.push({ slot: 'A.Q1', id: 'A.Q1#2', stimulus: { text: 'passage', items: [mcq('A.Q1#2@s1', 'A.Q1', 'A) 1'), mcq('A.Q1#2@s2', 'A.Q1', 'B) 2')] } });
  return ex;
};
const row = (id, check) => ({ slot: 'A.Q1', reason: check, items: [id], why: { [id]: check } });

describe('stuck takes an N20 or D16 item (bd-qyi45h.18)', () => {
  test('an N20 item inside a passage group is stuck', () => {
    expect([...GF.stuck({ shortfall: [row('A.Q1#2@s1', 'N20')] }, withGroup())]).toEqual(['A.Q1#2@s1']);
  });
  test('an N20 item outside any group is stuck', () => {
    expect([...GF.stuck({ shortfall: [row('A.Q1#1', 'N20')] }, withGroup())]).toEqual(['A.Q1#1']);
  });
  test('a D16 item is stuck, in a group or not', () => {
    const got = GF.stuck({ shortfall: [row('A.Q1#1', 'D16'), row('A.Q1#2@s2', 'D16')] }, withGroup());
    expect([...got].sort()).toEqual(['A.Q1#1', 'A.Q1#2@s2']);
  });
  test('an N20 or D16 row keyed by a slot id names no item and is not stuck', () => {
    expect([...GF.stuck({ shortfall: [row('A.Q1', 'N20'), row('A.Q1', 'D16')] }, withGroup())]).toEqual([]);
  });
  test('the re-ask is told the figure is never printed, and that the key must be the worked result', () => {
    expect(SP.checkFaults([{ check: 'N20', question: 'Use the figure.' }])[0]).toMatch(/^"Use the figure\.": .*figure/);
    expect(SP.checkFaults([{ check: 'D16', question: 'Find the speed.' }])[0]).toMatch(/^"Find the speed\.": .*work/);
  });
  test('N20 and D16 are still never last-try notes', () => {
    expect(LT.SOFT.N20).toBeUndefined();
    expect(LT.SOFT.D16).toBeUndefined();
  });
});

describe('writer: a passage that points at a figure after rewrite 1 is re-asked until it stops', () => {
  const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
  const prow = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
  const P = ssc1.subjects.physics;
  const variant = P.variants.find((v) => v.variant_id === '50pct');
  const told = (c) => /REWRITE/.test(c.user) && /graph or figure the paper does not print/.test(c.user);

  // Every passage-group question points at a figure until `freshAt` calls have been told about it.
  async function run(freshAt) {
    let made = null;
    const reply = (section, n, topUp, state) => {
      const tree = buildReply(section.slots, { grade: 9, row: prow, levels: TOS.levels, style: 'analytic_points' }, state);
      if (made.calls.filter(told).length >= freshAt) return tree;
      Object.values(tree).flat().filter((g) => g && Array.isArray(g.items)).forEach((g) => g.items.forEach((m) => {
        m.question = `Using the diagram shown above, ${m.question}`;
      }));
      return tree;
    };
    made = makeDeps({ grade: 9, row: prow, levels: TOS.levels, style: 'analytic_points', reply });
    made.d.logToFile = () => {};
    const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P, variant, requestId: 'r1' }, made.d).catch((e) => e);
    return { res, calls: made.calls };
  }

  test('rewrite 1 still points at a figure; the next re-ask is told again and the paper ships clean', async () => {
    const { res, calls } = await run(2);
    expect(res.code).toBeUndefined();
    expect(calls.filter(told).length).toBeGreaterThanOrEqual(2);
    expect(res.examJson._meta.checks.record.hard).toBe(0);
  });
});
