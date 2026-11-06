'use strict';
/**
 * bd-5jmnfj.38.30 round 6 (a8), the writer with the REAL board checks. Fictional replies modelled on the a8 cases.
 * (a) A hard key-leak on a stimulus child (FBISE SSC-I Physics A.Q41-60) maps to its id, so the group is dropped and
 *     rewritten instead of failing the paper with `items: []`.
 * (b) A same-section concept leak that survives one rewrite of the stem holder gets a second rewrite of the KEYED
 *     item, told the phrases not to use.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { leavesOf } = require(`${A}board-6-12/tree`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const { makeDeps, buildReply } = require('./helpers/fake-deps');
const { fictionalVariant, fictionalEntry } = require('./helpers/fictional-cell');

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const row = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
const rewrites = (calls) => calls.filter((c) => /REWRITE/.test(c.user));
const keyAs = (q, text) => { q.options[0] = `A) ${text}`; q.answer = q.options[0]; };

async function write(cell, reply) {
  const { d, calls } = makeDeps({ grade: 9, row, levels: cell.variant.cognitive_split.levels, style: cell.style, reply: (s, c, t, st) => reply(s, calls[calls.length - 1].user, st) });
  const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: cell.P, variant: cell.variant }, d).catch((e) => e);
  return { res, calls };
}

describe('(a) a stimulus child hard issue is dropped and rewritten', () => {
  const cell = { P: ssc1.subjects.physics, variant: ssc1.subjects.physics.variants.find((v) => v.variant_id === '50pct'), style: 'analytic_points' };
  test('the leaking group goes, a rewrite fills the slot, the paper renders', async () => {
    const { res, calls } = await write(cell, (section, user, st) => {
      const stim = section.slots.find((s) => s.stimulus);
      if (!stim || /REWRITE/.test(user)) return undefined;
      const tree = buildReply(section.slots, { grade: 9, row, levels: TOS.levels, style: cell.style, ur: false }, st);
      const g = tree[stim.slot][1];
      keyAs(g.items[0], 'acceleration due to gravity');
      g.items[1].question = 'LEAK: a made-up stone falls; its acceleration due to gravity is taken as 10 m/s^2. Which option fits?';
      return tree;
    });
    expect(res.code).toBeUndefined();
    expect(rewrites(calls)).toHaveLength(1);
    expect(rewrites(calls)[0].user).toMatch(/A\.Q41-60 \(rewrite /);
    expect(leavesOf(res.examJson).some((l) => /^LEAK/.test(l.question))).toBe(false);
  });
});

describe('(b) a second rewrite targets the keyed item', () => {
  const cell = { P: fictionalEntry(), variant: fictionalVariant(), style: 'holistic_bands' };
  test('the stem holder is rewritten once, still leaks, then the keyed item is rewritten with a phrase list', async () => {
    let n = 0;
    const { res, calls } = await write(cell, (section, user, st) => {
      if (section.id !== 'A') return undefined;
      const tree = buildReply(section.slots, { grade: 9, row, levels: TOS.levels, style: cell.style, ur: false }, st);
      n += 1;
      if (n === 1) {
        keyAs(tree['A.Q1'][0], 'constant speed');
        tree['A.Q1'][1].question = 'A made-up bus moves at constant speed. Which option fits case one?';
      } else if (n === 2) tree['A.Q1'][0].question = 'A made-up train also runs at constant speed. Which option fits case two?';
      return tree;
    });
    expect(res.code).toBeUndefined();
    const r = rewrites(calls);
    expect(r).toHaveLength(2);
    expect(r[1].user).toMatch(/A\.Q1 \(rewrite 1\)/);
    expect(r[1].user).toMatch(/Do not use these phrases: "constant speed"/);
    expect(leavesOf(res.examJson).some((l) => /constant speed/.test(String(l.answer)))).toBe(false);
  });
});
