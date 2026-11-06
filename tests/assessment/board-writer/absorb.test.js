'use strict';
/**
 * bd-5jmnfj.38.30 round 5 (a7: p3 G9 Physics ch2 and p4 G11 Chemistry ch2 both failed PATTERN_SHORT_SLOT in the repair
 * round, because every slot with a hard item had already been topped up). The checks now run before the trim: items
 * with hard issues are dropped, the +25% extras fill the gap, and a slot still short gets ONE targeted rewrite of the
 * dropped items (same slot, told the used keys and the stems to avoid). The version with fewer hard issues is kept.
 * key-leak, figure-ban and numeric-resolve all go this way. Fictional replies.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { leavesOf } = require(`${A}board-6-12/tree`);
const Checks = require(`${A}board-checks`);
const { makeDeps, buildReply } = require('./helpers/fake-deps');
const { fictionalVariant, fictionalEntry } = require('./helpers/fictional-cell');

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const row = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
const ctx = { grade: 9, row, levels: TOS.levels, style: 'holistic_bands', ur: false };
const P = fictionalEntry();
const variant = fictionalVariant();

/** The real checks, plus one hard issue of `check` per "HARD" in a leaf's stem (stands in for key-leak, figure-ban...). */
const flagging = (check, seen = []) => (ex, c) => {
  const r = Checks.run(ex, c);
  if (!c.probe) seen.push(r);
  leavesOf(ex).forEach((l) => (String(l.question).match(/HARD/g) || []).forEach(() => {
    r.shortfall.push({ slot: l.slot || String(l.id).split('#')[0], reason: check, items: [l.id], item_refs: [l.id], hard: true });
    r.record.hard += 1;
  }));
  return r;
};

/** A.Q1 (needs 4) comes back with 1 item; the top-up writes 4 (one extra), of which `bad` are HARD. */
function shortThenHard(bad, rewriteStem) {
  return (section, call, isTopUp, state) => {
    if (section.id !== 'A') return undefined;
    const tree = buildReply(section.slots, ctx, state);
    if (!isTopUp && !/REWRITE/.test(state.lastUser || '')) { tree['A.Q1'] = tree['A.Q1'].slice(0, 1); return tree; }
    if (isTopUp) tree['A.Q1'].slice(0, bad).forEach((q) => { q.question = `Item HARD: ${q.question}`; });
    else if (rewriteStem) tree['A.Q1'].forEach((q) => { q.question = rewriteStem; });
    return tree;
  };
}
const run = async (reply, check, seen) => {
  const { d, calls, state } = makeDeps({ ...ctx, reply: (s, c, t, st) => { st.lastUser = calls[calls.length - 1].user; return reply(s, c, t, st); } });
  d.checks = { run: flagging(check, seen) };
  const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P, variant }, d).catch((e) => e);
  return { res, calls };
};
const slotA = (ex) => leavesOf(ex).filter((l) => String(l.id).startsWith('A.Q1#'));

describe('extras absorb dropped items', () => {
  test('one hard item among the +25% extras is dropped and filled from them; no rewrite is asked', async () => {
    const { res, calls } = await run(shortThenHard(1), 'key-leak');
    expect(res.examJson).toBeDefined();
    expect(calls.some((c) => /REWRITE/.test(c.user))).toBe(false);
    expect(slotA(res.examJson)).toHaveLength(4);
    expect(slotA(res.examJson).some((l) => /HARD/.test(l.question))).toBe(false);
  });
});

describe('a topped-up slot still short after the drop gets one targeted rewrite', () => {
  test.each(['key-leak', 'figure-ban', 'numeric-resolve'])('%s: two hard items, one extra: one rewrite of one item', async (check) => {
    const { res, calls } = await run(shortThenHard(2), check);
    expect(res.code).toBeUndefined();
    const rewrites = calls.filter((c) => /REWRITE/.test(c.user));
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0].user).toMatch(/A\.Q1 \(rewrite 1\)/);
    expect(rewrites[0].user).toMatch(/Do not reuse these stems: .*Item HARD/);
    expect(rewrites[0].user).toMatch(/already keys in this paper/);
    expect(slotA(res.examJson)).toHaveLength(4);
    expect(slotA(res.examJson).some((l) => /HARD/.test(l.question))).toBe(false);
  });
});

describe('a rewrite that is still hard fails the paper after one try', () => {
  test('the version with fewer hard issues is the one reported', async () => {
    const { res, calls } = await run(shortThenHard(2, 'Item HARD HARD HARD: a made-up rewrite'), 'key-leak');
    expect(res.code).toBe('PATTERN_SHORT_SLOT');
    expect(calls.filter((c) => /REWRITE/.test(c.user))).toHaveLength(1);
    const stems = slotA(res.examJson).map((l) => l.question);
    expect(stems.filter((s) => /^Item HARD: /.test(s))).toHaveLength(1); // the originals (1 hard needed) beat the rewrite (3 hard)
    expect(stems.some((s) => /made-up rewrite/.test(s))).toBe(false);
  });
});
