'use strict';
/**
 * bd-qyi45h.7: a G10 Computer Science paper (prod 11 Nov 2026) was refused as PATTERN_SHORT_SLOT with B.Q2 holding
 * 9 of its 10 short questions (D12 SLOT_COUNT on the stored paper). The rewrite asked for exactly the items it had
 * dropped, the reply came back one short, and only MCQs can be restored, so nothing refilled the slot. The rewrite
 * now asks with the same slack as the first top-up (EXTRA); finish() trims any extras, so the slot ships full.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const T = require(`${A}board-6-12/tree`);
const { writeBoardPaper } = require(`${A}board-writer`);
const ssc2 = require(`${A}patterns/board/fbise-ssc2`);
const { makeDeps, buildReply } = require('./helpers/fake-deps');

const SLOT = 'B.Q2 (i)-(x)';
const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const prow = { code: 'computer_science', grade: 10, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.computer_science.9_10.system', tos_default: TOS, board_mode: 'board' };
const P = ssc2.subjects.computer_science;
const variant = P.variants.find((v) => v.variant_id === 'nonpct');

// First write of B: every short question pitched at A, so the level quota drops the extras (D12 LEVEL_OVER).
// Every rewrite of B comes back one item short of what it asked for.
async function run() {
  const ctx = { grade: 10, row: prow, levels: TOS.levels, style: 'analytic_points' };
  let made = null;
  const reply = (section, n, topUp, state) => {
    if (!section.slots.some((s) => s.slot === SLOT)) return undefined;
    const tree = buildReply(section.slots, ctx, state);
    const user = made.calls[made.calls.length - 1].user;
    if (/REWRITE/.test(user)) tree[SLOT] = (tree[SLOT] || []).slice(0, -1);
    else if (!topUp) (tree[SLOT] || []).forEach((q) => { q.tag.blooms = 'A'; });
    return tree;
  };
  made = makeDeps({ grade: 10, row: prow, levels: TOS.levels, style: 'analytic_points', reply });
  const res = await writeBoardPaper({ grade: 10, subject: 'computer_science', pattern: 'fbise_ssc2_2027', P, variant, requestId: 'r7' }, made.d).catch((e) => e);
  return { res, calls: made.calls };
}

describe('rewrite slack (bd-qyi45h.7)', () => {
  test('a rewrite reply one short still leaves B.Q2 with its 10 questions and the paper ships', async () => {
    const { res, calls } = await run();
    expect(calls.some((c) => /REWRITE/.test(c.user))).toBe(true); // the rewrite path ran
    expect(res.shortfall && JSON.stringify(res.shortfall)).toBeUndefined();
    expect(res.code).toBeUndefined();
    const have = T.liveCounts(res.examJson).get(SLOT);
    expect(have).toBe(10);
  });
});
