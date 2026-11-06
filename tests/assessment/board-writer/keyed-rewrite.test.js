'use strict';
/**
 * bd-5jmnfj.38.30 round 6 (a8), the writer with the REAL board checks. Fictional replies modelled on the a8 cases.
 * (a) A hard key-leak on a stimulus child (FBISE SSC-I Physics A.Q41-60) maps to its id, so the group is dropped and
 *     rewritten instead of failing the paper with `items: []`.
 * (b) A same-section concept leak that survives one rewrite of the stem holder gets a second rewrite of the KEYED
 *     item, told the phrases not to use.
 * (c) round 7 (a10): when the keyed item is a stimulus-group child and the stem holder a plain MCQ, the second
 *     rewrite takes the plain MCQ (easier to swap than a whole group); the writer logs which version won.
 * (d) round 7: an item dropped for a figure reference (N20) tells its rewrite to print the data or drop the graph.
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
  const logs = [];
  d.logToFile = (msg, extra) => logs.push({ msg, extra });
  const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: cell.P, variant: cell.variant }, d).catch((e) => e);
  return { res, calls, logs };
}
const SSC1 = { P: ssc1.subjects.physics, variant: ssc1.subjects.physics.variants.find((v) => v.variant_id === '50pct'), style: 'analytic_points' };
const replyOf = (section, st, cell) => buildReply(section.slots, { grade: 9, row, levels: TOS.levels, style: cell.style, ur: false }, st);

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

describe('(c) a keyed stimulus child: the second rewrite takes the plain MCQ that quotes it', () => {
  test('rewrite 2 targets A.Q1-40, not the group, and the winner is logged with each hard count', async () => {
    const planted = {};
    let rw = 0;
    const { res, calls, logs } = await write(SSC1, (section, user, st) => {
      const tree = replyOf(section, st, SSC1);
      if (/REWRITE/.test(user)) {
        rw += 1;
        if (rw === 1 && tree['A.Q1-40']) tree['A.Q1-40'][0].question = 'A made-up cart has uniform acceleration when its speed:';
        return tree;
      }
      // the two slots may come back in different chunk calls: plant each once, where it appears
      if (tree['A.Q41-60'] && !planted.key) { planted.key = true; keyAs(tree['A.Q41-60'][0].items[0], 'uniform acceleration'); }
      if (tree['A.Q1-40'] && !planted.stem) { planted.stem = true; tree['A.Q1-40'][0].question = 'A made-up body has uniform acceleration when its velocity:'; }
      return tree;
    });
    expect(res.code).toBeUndefined();
    const r = rewrites(calls);
    expect(r).toHaveLength(2);
    expect(r[1].user).toMatch(/A\.Q1-40 \(rewrite 1\)/);
    expect(r[1].user).not.toMatch(/A\.Q41-60 \(rewrite/);
    expect(r[1].user).toMatch(/Do not use these phrases: "uniform acceleration"/);
    const out = logs.find((l) => /board rewrite outcome/.test(l.msg));
    expect(out.extra.kept).toBe('rewrite 2');
    expect(out.extra.tries.map((t) => [t.name, t.hard])).toEqual([['rewrite 2', 0], ['rewrite 1', 1]]);
    // round 8: each try names the checks its hard issues came from (check name -> hard count; clean checks left out)
    expect(out.extra.tries[0].by_check).toEqual({});
    const by1 = out.extra.tries[1].by_check;
    expect(Object.values(by1)).toEqual([1]);
    expect(Object.keys(by1)[0]).toMatch(/^[a-z-]+$/);
  });
});

describe('(d) a figure-reference drop asks for the data or no graph', () => {
  test('the rewrite of an N20 drop says to print the data or ask without a graph', async () => {
    let planted = false;
    const { res, calls } = await write(SSC1, (section, user, st) => {
      const tree = replyOf(section, st, SSC1);
      if (/REWRITE/.test(user) || planted || !tree['A.Q41-60']) return tree;
      planted = true;
      const g = tree['A.Q41-60'][0];
      g.stimulus = 'Bilal studies a made-up car that speeds up steadily for 10 s. Bilal draws a speed-time graph of this journey.';
      g.items[0].question = 'The distance covered in the first 10 s is found from the graph as the:';
      return tree;
    });
    expect(res.code).toBeUndefined();
    const r = rewrites(calls);
    expect(r).toHaveLength(1);
    expect(r[0].user).toMatch(/print the data the student needs \(a table or the values\)/);
    expect(r[0].user).toMatch(/or ask the idea without referring to a graph or figure/);
  });
});
