'use strict';
/**
 * bd-qyi45h.6 (3): a hard key leak (N18) on a passage child was never re-asked. dropIds takes the whole passage and
 * the restore never touches a group, so it rode every try to the end (prod 11 Nov 2026, G9 Physics and G11 Computer
 * Science). The passage re-ask that review faults get (GF.ATTEMPTS) now takes a leaking child too, told the phrases.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const GF = require(`${A}board-6-12/group-faults`);
const Checks = require(`${A}board-checks`);
const { writeBoardPaper } = require(`${A}board-writer`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const { makeDeps } = require('./helpers/fake-deps');
const { mcq, row: slotRow, paper } = require('../board-checks/paper-builder');

const withGroup = () => {
  const ex = paper({ sections: [{ id: 'A', marks: 3, slots: [slotRow('A.Q1', { attempt: 3, printed: 3, generate: 3 })] }], items: [mcq('A.Q1#1', 'A.Q1', 'A) 1')] });
  ex.unseen.objective.mcq.push({ slot: 'A.Q1', id: 'A.Q1#2', stimulus: { text: 'passage', items: [mcq('A.Q1#2@s1', 'A.Q1', 'A) 1'), mcq('A.Q1#2@s2', 'A.Q1', 'B) 2')] } });
  return ex;
};
const leakRow = (holder, keyed, phrase) => ({ slot: 'A.Q1', reason: 'N18', items: [holder], why: { [holder]: 'N18' }, keyed: [{ id: keyed, phrase, holder }] });

describe('stuck and leakPhrases', () => {
  test('a passage child with a hard N18 is stuck; a plain MCQ with one is not', () => {
    const checks = { shortfall: [leakRow('A.Q1#2@s2', 'A.Q1#2@s1', 'gravitational force'), leakRow('A.Q1#1', 'A.Q1#2@s1', 'mass')] };
    expect([...GF.stuck(checks, withGroup())]).toEqual(['A.Q1#2@s2']);
  });
  test('review-flagged passage children are still stuck', () => {
    const checks = { shortfall: [{ slot: 'A.Q1', items: ['A.Q1#2@s1'], review: { 'A.Q1#2@s1': ['level_wrong'] } }] };
    expect([...GF.stuck(checks, withGroup())]).toEqual(['A.Q1#2@s1']);
  });
  test('leakPhrases names the phrases of the stuck holders only, once each', () => {
    const checks = { shortfall: [leakRow('A.Q1#2@s2', 'A.Q1#2@s1', 'gravitational force'), leakRow('A.Q1#1', 'A.Q1#2@s1', 'mass')] };
    expect(GF.leakPhrases(checks, new Set(['A.Q1#2@s2']))).toEqual(['gravitational force']);
  });
});

describe('writer: a passage child that leaks is re-asked with the phrase', () => {
  const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
  const prow = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
  const P = ssc1.subjects.physics;
  const variant = P.variants.find((v) => v.variant_id === '50pct');

  // the real checks, plus a hard N18 on the first passage child until a re-ask has been told the phrase
  const told = (calls) => calls.some((c) => /REWRITE/.test(c.user) && /"made-up phrase"/.test(c.user));
  async function run() {
    const { d, calls } = makeDeps({ grade: 9, row: prow, levels: TOS.levels, style: 'analytic_points' });
    d.checks = { run: (ex, ctx) => {
      const out = Checks.run(ex, ctx);
      const child = [...GF.memberIds(ex)][0];
      if (child == null || told(calls)) return out;
      out.shortfall.push({ ...leakRow(child, 'other', 'made-up phrase'), slot: String(child).split('#')[0] });
      out.record.hard += 1;
      return out;
    } };
    const logs = [];
    const log = d.logToFile;
    d.logToFile = (msg, data) => { logs.push({ msg, data }); return log && log(msg, data); };
    const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P, variant, requestId: 'r1' }, d).catch((e) => e);
    return { res, calls, logs };
  }

  test('a leak no earlier try clears: rewrite 3 re-asks the passage, told the phrase, and the paper ships clean', async () => {
    const { res, calls, logs } = await run();
    expect(res.code).toBeUndefined();
    const out = logs.find((l) => /rewrite outcome/.test(l.msg));
    expect(out.data.tries.map((t) => t.name)).toContain('rewrite 3');
    expect(told(calls)).toBe(true);
    expect(res.examJson._meta.checks.record.hard).toBe(0);
  });
});
