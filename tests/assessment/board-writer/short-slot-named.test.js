'use strict';
/**
 * bd-qyi45h.9: prod paper 61750f41 failed PATTERN_SHORT_SLOT naming only a hard item (A.Q1#10) while the slot that was
 * actually short (B.Q2, 9 of 10) went unnamed: the thrown shortfall was the checks' rows OR the short slots, never both.
 * Here B.Q2's rewrites come back empty and a planted hard check flags the first item; the error must name both.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { makeRun, MEMBERS } = require(`${A}board-checks`);
const { leaves } = require(`${A}board-checks/walk`);
const { issue } = require(`${A}board-checks/common`);
const ssc2 = require(`${A}patterns/board/fbise-ssc2`);
const { makeDeps, buildReply } = require('./helpers/fake-deps');

const SLOT = 'B.Q2 (i)-(x)';
const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const prow = { code: 'computer_science', grade: 10, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.computer_science.9_10.system', tos_default: TOS, board_mode: 'board' };
const P = ssc2.subjects.computer_science;
const variant = P.variants.find((v) => v.variant_id === 'nonpct');
const planted = {
  id: 'N20', name: 'always-N20', hard: true, modes: ['board'], LIMITS: {},
  run: (ex) => ({ ok: false, issues: leaves(ex).slice(0, 1).map((q) => issue('N20', 'FIGURE', q.ref, 'planted', true)) }),
};

test('a short slot and a hard item left on the last try are both named in the error', async () => {
  const ctx = { grade: 10, row: prow, levels: TOS.levels, style: 'analytic_points' };
  let made = null;
  const reply = (section, n, topUp, state) => {
    if (!section.slots.some((s) => s.slot === SLOT)) return undefined;
    const tree = buildReply(section.slots, ctx, state);
    if (/REWRITE/.test(made.calls[made.calls.length - 1].user)) tree[SLOT] = [];
    else if (!topUp) (tree[SLOT] || []).forEach((q) => { q.tag.blooms = 'A'; });
    return tree;
  };
  made = makeDeps({ ...ctx, reply });
  made.d.checks = { run: makeRun([...MEMBERS, planted]) };
  const err = await writeBoardPaper({ grade: 10, subject: 'computer_science', pattern: 'fbise_ssc2_2027', P, variant, requestId: 'r9' }, made.d).catch((e) => e);
  expect(err.code).toBe('PATTERN_SHORT_SLOT');
  expect(err.shortfall).toEqual(expect.arrayContaining([{ slot: SLOT, have: 2, need: 10 }]));
  expect(err.shortfall.some((r) => Array.isArray(r.items) && r.items.length)).toBe(true);
});
