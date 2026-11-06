'use strict';
/** The board writer's repair round (bd-5jmnfj.38.30): it is told the keys already used, and the re-check knows which items are new. */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const Checks = require(`${A}board-checks`);
const { makeDeps, buildReply } = require('./helpers/fake-deps');
const { fictionalVariant, fictionalEntry } = require('./helpers/fictional-cell');

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const row = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: TOS, board_mode: 'board' };
const cell = { grade: 9, subject: 'physics', P: fictionalEntry(), variant: fictionalVariant(), row, style: 'holistic_bands' };

function leakOnce() {
  let leaked = false;
  return (section, call, isTopUp, state) => {
    if (section.id !== 'A') return undefined;
    const tree = buildReply(section.slots, { grade: 9, row, levels: TOS.levels, style: cell.style, ur: false }, state);
    if (!leaked) {
      leaked = true;
      const q = tree['A.Q1'][0];
      q.question = `${q.question} (the answer is ${q.answer.slice(3)})`;
    }
    return tree;
  };
}

describe('board writer repair round', () => {
  test('the repair ask lists the keys already in the paper and says not to state them', async () => {
    const { d, calls } = makeDeps({ ...cell, levels: TOS.levels, reply: leakOnce() });
    const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: cell.P, variant: cell.variant }, d);
    const repair = calls.filter((c) => c.section === 'A' && c.topUp).pop();
    const kept = res.examJson.unseen ? JSON.stringify(res.examJson) : '';
    expect(repair.user).toMatch(/already keys in this paper/);
    const m = /already keys in this paper[^:]*: (.*)$/m.exec(repair.user);
    const listed = m[1].split('; ').map((s) => s.replace(/^"|"\.?$|"$/g, ''));
    expect(listed.length).toBeGreaterThan(0);
    listed.forEach((k) => expect(kept).toContain(k));
  });
  test('the re-check is told which items are the replacements', async () => {
    const seen = [];
    const { d } = makeDeps({ ...cell, levels: TOS.levels, reply: leakOnce() });
    d.checks = { run: (ex, ctx) => { seen.push(ctx.fresh); return Checks.run(ex, ctx); } };
    await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'p', P: cell.P, variant: cell.variant }, d);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeUndefined();
    expect([...seen[1]]).toEqual(['A.Q1#1']); // the dropped item's id is free again; only the replacement takes it
  });
});
