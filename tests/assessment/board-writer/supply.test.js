'use strict';
/**
 * bd-5jmnfj.38.30 round 4: how the board writer gets enough clean items. Long slots are asked in chunks of 20 or
 * fewer, a top-up asks for the shortfall plus about a quarter, extras with issues are trimmed first, an empty
 * `options` on a written item is dropped, and the repair round replaces only the leaking item. Fictional replies.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { leavesOf } = require(`${A}board-6-12/tree`);
const { leaves } = require(`${A}board-checks/walk`);
const Checks = require(`${A}board-checks`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const { makeDeps, buildReply } = require('./helpers/fake-deps');
const { fictionalVariant, fictionalEntry } = require('./helpers/fictional-cell');

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const row = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
const ctxOf = (style) => ({ grade: 9, row, levels: TOS.levels, style, ur: false });
const fictional = { P: fictionalEntry(), variant: fictionalVariant(), style: 'holistic_bands' };
const physics50 = { P: ssc1.subjects.physics, variant: ssc1.subjects.physics.variants.find((v) => v.variant_id === '50pct'), style: 'analytic_points' };

const write = async (cell, reply, checks) => {
  const { d, calls, state } = makeDeps({ grade: 9, row, levels: TOS.levels, style: cell.style, reply });
  if (checks) d.checks = { run: checks };
  const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: cell.P, variant: cell.variant }, d);
  return { res, calls, state };
};
const slotLeaves = (ex, slot) => leavesOf(ex).filter((l) => l.slot === slot || String(l.id).startsWith(`${slot}#`));

describe('written items with an empty options list', () => {
  test('an srq written with "options": [] loses the key and the paper passes', async () => {
    const reply = (section, call, isTopUp, state) => {
      if (section.id !== 'B') return undefined;
      const tree = buildReply(section.slots, ctxOf(fictional.style), state);
      Object.values(tree).forEach((list) => list.forEach((q) => (q.or || [q]).forEach((l) => { l.options = []; })));
      return tree;
    };
    const { res } = await write(fictional, reply);
    const written = leavesOf(res.examJson).filter((l) => l.type === 'srq');
    expect(written.length).toBeGreaterThan(0);
    written.forEach((l) => expect('options' in l).toBe(false));
    expect(leavesOf(res.examJson).filter((l) => l.type === 'mcq').every((l) => l.options.length === 4)).toBe(true);
  });
});

describe('long slots are asked in chunks of 20 or fewer', () => {
  test('A.Q1-40 is two calls of 20; the second is told the stems and keys already written', async () => {
    const { res, calls } = await write(physics50);
    const mcq = calls.filter((c) => c.section === 'A' && !c.topUp && /\[slot A\.Q1-40\]/.test(c.system));
    expect(mcq).toHaveLength(2);
    mcq.forEach((c) => expect(c.system).toMatch(/\[slot A\.Q1-40\]: 20 x mcq/));
    expect(mcq[0].user).not.toMatch(/CHUNK/);
    expect(mcq[1].user).toMatch(/CHUNK: items 21-40 of slot A\.Q1-40/);
    expect(mcq[1].user).toMatch(/already keys in this paper/);
    expect(mcq[1].system).toMatch(/Item 20: choose/);
    expect(slotLeaves(res.examJson, 'A.Q1-40')).toHaveLength(40);
  });
});

describe('the top-up asks for a quarter more and trims extras with issues first', () => {
  const shortA = (section, call, isTopUp, state) => {
    if (section.id !== 'A') return undefined;
    const tree = buildReply(section.slots, ctxOf(fictional.style), state);
    if (!isTopUp) tree['A.Q1'] = tree['A.Q1'].slice(0, 1);
    else tree['A.Q1'][0].question = 'Item SOFT: choose the statement that fits the made-up case';
    return tree;
  };
  test('3 short asks for 4; the extra with a soft issue is the one trimmed', async () => {
    const softOn = (ex, ctx) => {
      const r = Checks.run(ex, ctx);
      leaves(ex).filter((l) => /Item SOFT/.test(l.item.question)).forEach((l) => r.notes.push({ check: 'readability', item_ref: l.ref, msg: 'made up', hard: false }));
      return r;
    };
    const { res, calls } = await write(fictional, shortA, softOn);
    const top = calls.find((c) => c.section === 'A' && c.topUp);
    expect(top.user).toMatch(/A\.Q1 \(have 1, need 4; write 4\)/);
    const kept = slotLeaves(res.examJson, 'A.Q1');
    expect(kept).toHaveLength(4);
    expect(kept.some((l) => /Item SOFT/.test(l.question))).toBe(false);
  });
});

describe('the repair round replaces only the leaking item', () => {
  test('the other items of the slot keep their ids and stems', async () => {
    let leaked = false;
    let firstStems = null;
    const reply = (section, call, isTopUp, state) => {
      if (section.id !== 'A') return undefined;
      const tree = buildReply(section.slots, ctxOf(fictional.style), state);
      if (!leaked) {
        leaked = true;
        const q = tree['A.Q1'][1];
        q.question = `${q.question} (the answer is ${q.answer.slice(3)})`;
        firstStems = tree['A.Q1'].map((x) => x.question);
      }
      return tree;
    };
    const { res } = await write(fictional, reply);
    const kept = slotLeaves(res.examJson, 'A.Q1');
    expect(kept.map((l) => l.question)).toEqual(expect.arrayContaining([firstStems[0], firstStems[2], firstStems[3]]));
    expect(kept.map((l) => l.question)).not.toContain(firstStems[1]);
    expect(kept.filter((l) => firstStems.includes(l.question)).map((l) => l.id)).toEqual(['A.Q1#1', 'A.Q1#3', 'A.Q1#4']);
  });
});
