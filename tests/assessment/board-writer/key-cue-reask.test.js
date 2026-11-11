'use strict';
/**
 * bd-qyi45h.4: a D18 KEY_LONGEST left after rewrite 1 rode to the end of the board writer (prod 11 Nov 2026, G11
 * Computer Science and G9 Physics: D18 among the hard rules of a paper refused as PATTERN_SHORT_SLOT). The re-ask
 * loop the N18 key-leak fix uses (GF.stuck, up to GF.ATTEMPTS) now takes a D18 item too, told to keep the options
 * the same length. The rule stays hard: thresholds unchanged, numeric MCQs never length-checked.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const GF = require(`${A}board-6-12/group-faults`);
const KC = require(`${A}board-checks/key-cue`);
const { writeBoardPaper } = require(`${A}board-writer`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const { makeDeps, buildReply } = require('./helpers/fake-deps');
const { mcq, row: slotRow, paper, ctxBoard } = require('../board-checks/paper-builder');

const withGroup = () => {
  const ex = paper({ sections: [{ id: 'A', marks: 3, slots: [slotRow('A.Q1', { attempt: 3, printed: 3, generate: 3 })] }], items: [mcq('A.Q1#1', 'A.Q1', 'A) 1')] });
  ex.unseen.objective.mcq.push({ slot: 'A.Q1', id: 'A.Q1#2', stimulus: { text: 'passage', items: [mcq('A.Q1#2@s1', 'A.Q1', 'A) 1'), mcq('A.Q1#2@s2', 'A.Q1', 'B) 2')] } });
  return ex;
};
const cueRow = (id, check = 'D18') => ({ slot: 'A.Q1', reason: check, items: [id], why: { [id]: check } });

describe('stuck takes a D18 item (bd-qyi45h.4)', () => {
  test('a D18 passage child and a D18 plain MCQ are both stuck', () => {
    const checks = { shortfall: [cueRow('A.Q1#2@s1'), cueRow('A.Q1#1')] };
    expect([...GF.stuck(checks, withGroup())].sort()).toEqual(['A.Q1#1', 'A.Q1#2@s1']);
  });
  test('another hard check on a plain MCQ is still not stuck', () => {
    expect([...GF.stuck({ shortfall: [cueRow('A.Q1#1', 'D12')] }, withGroup())]).toEqual([]);
  });
});

describe('D18 stays as it was', () => {
  test('thresholds unchanged', () => { expect(KC.LIMITS).toEqual({ ratio: 1.5, minGap: 12 }); });
  test('a numeric MCQ is never length-checked, however long its key', () => {
    const it = mcq('a', 's', 'D) 1234567890123456', ['A) 1', 'B) 2', 'C) 3', 'D) 1234567890123456']);
    const ex = paper({ sections: [{ id: 'A', marks: 1, slots: [slotRow('s', { attempt: 1, printed: 1 })] }], items: [it] });
    expect(KC.run(ex, ctxBoard()).issues).toEqual([]);
  });
});

describe('writer: an MCQ whose key stands out is re-asked until the options are balanced', () => {
  const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
  const prow = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
  const P = ssc1.subjects.physics;
  const variant = P.variants.find((v) => v.variant_id === '50pct');
  const LONG = 'a body keeps moving at the same steady speed in one straight line';
  const told = (c) => /REWRITE/.test(c.user) && /key stood out[^\n]*same length/.test(c.user);

  // The real checks throughout. The first MCQ of the first passage gets a long key in every reply until `balanceAt`
  // calls have been told the D18 fault (Infinity = never balanced).
  async function run(balanceAt, grade = 9) {
    const ctx = { grade, row: prow, levels: TOS.levels, style: 'analytic_points' };
    let made = null;
    const reply = (section, n, topUp, state) => {
      const tree = buildReply(section.slots, ctx, state);
      const group = Object.values(tree).flat().find((q) => Array.isArray(q.items));
      if (!group || made.calls.filter(told).length >= balanceAt) return tree;
      const it = group.items[0];
      const k = it.options.findIndex((o) => o === it.answer);
      it.options[k] = `${it.options[k].slice(0, 3)}${LONG}`;
      it.answer = it.options[k];
      return tree;
    };
    made = makeDeps({ grade, row: prow, levels: TOS.levels, style: 'analytic_points', reply });
    const logs = [];
    made.d.logToFile = (msg, data) => { logs.push({ msg, data }); };
    const res = await writeBoardPaper({ grade, subject: 'physics', pattern: 'p', P, variant, requestId: 'r1' }, made.d).catch((e) => e);
    return { res, calls: made.calls, logs };
  }
  const triesOf = (logs) => logs.find((l) => /rewrite outcome/.test(l.msg)).data.tries.map((t) => t.name);

  test('rewrite 1 still long, the next re-ask is told the options must match in length and the paper ships clean', async () => {
    const { res, calls, logs } = await run(2);
    expect(res.code).toBeUndefined();
    expect(triesOf(logs)).toContain('rewrite 3');
    expect(calls.filter(told).length).toBeGreaterThanOrEqual(2);
    expect(res.examJson._meta.checks.record.hard).toBe(0);
    expect(res.examJson._meta.checks.record.shipped_last_try).toBeUndefined();
  });

  test('a key that stays long stays hard through every re-ask; G9-12 ships it only as the approved last-try note (bd-qyi45h.3)', async () => {
    const { res, logs } = await run(Infinity, 9);
    expect(triesOf(logs)).toContain(`rewrite ${2 + GF.ATTEMPTS}`);
    expect(res.code).toBeUndefined();
    expect(res.examJson._meta.checks.notes).toContainEqual(expect.objectContaining({ check: 'D18', last_try: true }));
    expect(res.examJson._meta.checks.record.shipped_last_try).toMatchObject({ 'D18 KEY_LONGEST': expect.any(Number) });
  });
});
