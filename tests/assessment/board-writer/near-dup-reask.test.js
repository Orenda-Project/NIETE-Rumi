'use strict';
/**
 * bd-qyi45h.14: a D17 near-dup left after rewrite 1 rode to the end of the board writer (G11 Physics ch1, dry run
 * 14 Nov 2026: rewrite 1 of section B wrote a short question that asked the same as another one; rewrites 3-5 only
 * re-ask review faults and key leaks inside passage groups, and D17 is not a last-try note, so the paper failed
 * PATTERN_SHORT_SLOT). The re-ask loop (GF.stuck, up to GF.ATTEMPTS) now takes a D17 item too, told what it repeated.
 * The rule stays hard and is never shipped as a note: a paper must not ask the same thing twice.
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

const plain = () => paper({ sections: [{ id: 'A', marks: 2, slots: [slotRow('A.Q1', { attempt: 2, printed: 2, generate: 2 })] }], items: [mcq('A.Q1#1', 'A.Q1', 'A) 1'), mcq('A.Q1#2', 'A.Q1', 'A) 1')] });
const dupRow = (id, check = 'D17') => ({ slot: 'A.Q1', reason: check, items: [id], why: { [id]: check } });

describe('stuck takes a D17 item (bd-qyi45h.14)', () => {
  test('a D17 item outside any group is stuck', () => {
    expect([...GF.stuck({ shortfall: [dupRow('A.Q1#2')] }, plain())]).toEqual(['A.Q1#2']);
  });
  test('the re-ask is told the dropped item repeated another question', () => {
    expect(SP.checkFaults([{ check: 'D17', question: 'Explain precision' }])[0]).toMatch(/"Explain precision": .*same .*another question/);
  });
  test('D17 is still never a last-try note', () => { expect(LT.SOFT.D17).toBeUndefined(); });
});

describe('writer: a short question that repeats another is re-asked until it asks something new', () => {
  const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
  const prow = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
  const P = ssc1.subjects.physics;
  const variant = P.variants.find((v) => v.variant_id === '50pct');
  const STEM = 'Explain how precision and accuracy are shown by the uncertainty of a measured length reading';
  const told = (c) => /REWRITE/.test(c.user) && /same as another question/.test(c.user);

  // Real checks throughout. Every short-answer reply repeats STEM (the original reply twice, so D17 fires on its later
  // copy) (every rewrite reply wholly, so its slack cannot absorb the drop) until `freshAt` calls have been told the D17 fault (Infinity = never fresh).
  async function run(freshAt) {
    const ctx = { grade: 9, row: prow, levels: TOS.levels, style: 'analytic_points' };
    let made = null;
    const reply = (section, n, topUp, state) => {
      const tree = buildReply(section.slots, ctx, state);
      const srqs = Object.values(tree).flat().filter((q) => q && !q.options && !q.items && typeof q.question === 'string');
      if (!srqs.length || made.calls.filter(told).length >= freshAt) return tree;
      srqs.slice(0, /REWRITE/.test(made.calls[made.calls.length - 1].user) ? srqs.length : 2).forEach((q) => { q.question = STEM; });
      return tree;
    };
    made = makeDeps({ grade: 9, row: prow, levels: TOS.levels, style: 'analytic_points', reply });
    const logs = [];
    made.d.logToFile = (msg, data) => { logs.push({ msg, data }); };
    const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P, variant, requestId: 'r1' }, made.d).catch((e) => e);
    return { res, calls: made.calls, logs };
  }
  const triesOf = (logs) => logs.find((l) => /rewrite outcome/.test(l.msg)).data.tries.map((t) => t.name);

  test('rewrite 1 still repeats, the next re-ask is told what it repeated and the paper ships clean', async () => {
    const { res, calls, logs } = await run(2);
    expect(res.code).toBeUndefined();
    expect(triesOf(logs)).toContain('rewrite 3');
    expect(calls.filter(told).length).toBeGreaterThanOrEqual(2);
    expect(res.examJson._meta.checks.record.hard).toBe(0);
  });
});
