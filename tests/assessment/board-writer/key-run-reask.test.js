'use strict';
/**
 * bd-qyi45h.16: a D13 KEY_RUN inside a passage group rode to the end of the board writer (G11 Physics ch1, dry run
 * 14 Nov 2026: passage 1 of Q1 (57-80) held four all-number MCQs, each keyed C. Numbers print in ascending order, so
 * settleKeys cannot move those keys; rewrites 3-5 re-asked only review faults, key leaks, D17 and D18, and D13 is not
 * a last-try note, so the paper failed PATTERN_SHORT_SLOT). The re-ask loop now takes a D13 item too, told why.
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
const row = (id, check) => ({ slot: 'A.Q1', reason: check, items: [id], why: { [id]: check } });

describe('stuck takes a D13 item (bd-qyi45h.16)', () => {
  test('a D13 item is stuck', () => {
    expect([...GF.stuck({ shortfall: [row('A.Q1#2', 'D13')] }, plain())]).toEqual(['A.Q1#2']);
  });
  test('a D13 row keyed by a group or section id (KEY_SHARE) is not: there is no item to re-ask', () => {
    expect([...GF.stuck({ shortfall: [row('A.Q1', 'D13')] }, plain())]).toEqual([]);
  });
  test('the re-ask is told the answer letter repeated and how to move it when the options are numbers', () => {
    const [line] = SP.checkFaults([{ check: 'D13', question: 'Find the length.' }]);
    expect(line).toMatch(/^"Find the length\.": /);
    expect(line).toMatch(/same answer letter/);
    expect(line).toMatch(/ascending/);
  });
  test('D13 is still never a last-try note', () => { expect(LT.SOFT.D13).toBeUndefined(); });
});

describe('writer: a passage whose number answers all sit at C is re-asked until the letters vary', () => {
  const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
  const prow = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
  const P = ssc1.subjects.physics;
  const variant = P.variants.find((v) => v.variant_id === '50pct');
  const told = (c) => /REWRITE/.test(c.user) && /same answer letter/.test(c.user);

  async function run(freshAt) {
    let made = null;
    const reply = (section, n, topUp, state) => {
      const tree = buildReply(section.slots, { grade: 9, row: prow, levels: TOS.levels, style: 'analytic_points' }, state);
      if (made.calls.filter(told).length >= freshAt) return tree;
      Object.values(tree).flat().filter((g) => g && Array.isArray(g.items)).forEach((g) => g.items.forEach((m, i) => {
        const v = [10, 20, 30, 40].map((x) => x + i * 100 + state.n);
        m.options = v.map((x, j) => `${'ABCD'[j]}) ${x}`);
        m.answer = m.options[2];
      }));
      return tree;
    };
    made = makeDeps({ grade: 9, row: prow, levels: TOS.levels, style: 'analytic_points', reply });
    const logs = [];
    made.d.logToFile = (msg, data) => { logs.push({ msg, data }); };
    const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P, variant, requestId: 'r1' }, made.d).catch((e) => e);
    return { res, calls: made.calls, logs };
  }

  test('the passage is re-asked, told the letters repeated, and the paper ships clean', async () => {
    const { res, calls } = await run(1);
    expect(res.code).toBeUndefined();
    expect(calls.filter(told).length).toBeGreaterThanOrEqual(1);
    expect(res.examJson._meta.checks.record.hard).toBe(0);
  });
});
