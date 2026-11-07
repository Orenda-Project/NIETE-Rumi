'use strict';
/**
 * bd-5jmnfj.38.34: a review fault on a member of a kept stimulus group is a hard fault, not a note. The group is
 * re-asked once more; if its replacement is still flagged the paper fails instead of shipping the fault.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const MR = require(`${A}board-6-12/mcq-review`);
const GF = require(`${A}board-6-12/group-faults`);
const { writeBoardPaper } = require(`${A}board-writer`);
const { leavesOf } = require(`${A}board-6-12/tree`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const { makeDeps } = require('./helpers/fake-deps');
const { mcq, row: slotRow, paper } = require('../board-checks/paper-builder');

describe('memberIds', () => {
  test('ids of MCQs inside a stimulus group; plain MCQs are not listed', () => {
    const ex = paper({
      sections: [{ id: 'A', marks: 3, slots: [slotRow('A.Q1', { attempt: 3, printed: 3, generate: 3 })] }],
      items: [mcq('A.Q1#1', 'A.Q1', 'A) 1')],
    });
    ex.unseen.objective.mcq.push({ slot: 'A.Q1', id: 'A.Q1#2', stimulus: { text: 'passage', items: [mcq('A.Q1#2@s1', 'A.Q1', 'A) 1'), mcq('A.Q1#2@s2', 'A.Q1', 'B) 2')] } });
    expect([...GF.memberIds(ex)].sort()).toEqual(['A.Q1#2@s1', 'A.Q1#2@s2']);
  });
});

describe('soften keeps group-member review faults hard', () => {
  test('a keep set leaves those ids in the shortfall and counted hard; the rest turn to notes', () => {
    const ex = paper({
      sections: [{ id: 'A', marks: 2, slots: [slotRow('A.Q1', { attempt: 2, printed: 2, generate: 2 })] }],
      items: [mcq('A.Q1#1', 'A.Q1', 'A) 1'), mcq('A.Q1#2', 'A.Q1', 'A) 1')],
    });
    const f = MR.flagsFrom({ items: [{ n: 1, level_wrong: true }, { n: 2, level_wrong: true }] }, MR.sectionsOf(ex)[0]);
    const checks = { shortfall: [], notes: [], record: { hard: 0, per_check: {} } };
    MR.applyFlags(checks, f, ex);
    MR.soften(checks, f, new Set(['A.Q1#2']));
    expect(checks.shortfall).toHaveLength(1);
    expect(checks.shortfall[0].items).toEqual(['A.Q1#2']);
    expect(checks.record.hard).toBe(1);
    expect(checks.notes.filter((n) => n.check === 'review').map((n) => n.id)).toEqual(['A.Q1#1']);
  });
});

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const prow = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
const P = ssc1.subjects.physics;
const variant = P.variants.find((v) => v.variant_id === '50pct');

// flags every item that carries a "stimulus:" line in the review request (a group member), `times` review calls
// `passes`: flag only while fewer than that many whole review passes have been logged (initial, rewrite 1, ...)
async function run(times, passes) {
  let k = 0;
  let logged = 0;
  let calls;
  const logs = [];
  ({ d: run.d, calls } = makeDeps({ grade: 9, row: prow, levels: TOS.levels, style: 'analytic_points', reply: (section) => {
    if (!String(section.id).startsWith('review-')) return undefined;
    k += 1;
    if (passes != null ? logged >= passes : k > times) return { items: [] };
    const user = calls[calls.length - 1].user;
    const ns = [...user.matchAll(/   stimulus:[^\n]*\n(\d+)\. /g)].map((m) => Number(m[1]));
    return { items: ns.map((n) => ({ n, level_wrong: true, why: 'tag too high' })) };
  } }));
  run.d.reviewMcqs = true;
  const log = run.d.logToFile;
  run.d.logToFile = (msg, data) => { if (/MCQ review$/.test(msg)) logged += 1; logs.push({ msg, data }); return log && log(msg, data); };
  const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P, variant, requestId: 'r1' }, run.d).catch((e) => e);
  return { res, calls, logs };
}

describe('writer: a flagged group member never ships as a note', () => {
  test('flagged on every review: the paper fails rather than carry the group', async () => {
    const { res } = await run(99);
    expect(res.code).toBe('PATTERN_SHORT_SLOT');
  });
  test('flagged once: the group is re-asked and the paper ships with no group note', async () => {
    const { res, calls } = await run(1);
    expect(res.code).toBeUndefined();
    expect(calls.some((c) => /REWRITE/.test(c.user))).toBe(true);
    expect(res.examJson._meta.checks.notes.filter((n) => n.check === 'review')).toEqual([]);
    expect(leavesOf(res.examJson).length).toBeGreaterThan(0);
  });
  test('still flagged after rewrite 1: rewrite 3 re-asks the group and the paper ships clean', async () => {
    const { res, calls, logs } = await run(null, 2);
    expect(res.code).toBeUndefined();
    const asks = calls.filter((c) => /REWRITE/.test(c.user)).length;
    expect(asks).toBeGreaterThanOrEqual(2);
    const out = logs.find((l) => /rewrite outcome/.test(l.msg));
    expect(out.data.tries.map((t) => t.name)).toContain('rewrite 3');
    expect(res.examJson._meta.checks.notes.filter((n) => n.check === 'review')).toEqual([]);
  });
  test('flagged through rewrite 3: rewrite 4 re-asks again and the paper ships clean', async () => {
    const { res, logs } = await run(null, 3);
    expect(res.code).toBeUndefined();
    const out = logs.find((l) => /rewrite outcome/.test(l.msg));
    expect(out.data.tries.map((t) => t.name)).toEqual(expect.arrayContaining(['rewrite 3', 'rewrite 4']));
  });
});
