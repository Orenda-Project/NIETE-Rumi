'use strict';
/**
 * bd-qyi45h.3 in the writer: a check that stays hard through every rewrite. A soft-listed flaw (D18) ships a G9-12
 * paper with last-try notes; the same flaw on G8, or a flaw off the list on G9, still fails PATTERN_SHORT_SLOT.
 * Fictional cell, fake model; the extra checker always flags the first item of the paper.
 */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { makeRun, MEMBERS } = require(`${A}board-checks`);
const { leaves } = require(`${A}board-checks/walk`);
const { issue } = require(`${A}board-checks/common`);
const { makeDeps } = require('./helpers/fake-deps');
const { fictionalVariant, fictionalEntry } = require('./helpers/fictional-cell');

const variant = fictionalVariant();
const rowFor = (grade) => ({ code: 'physics', grade, band: grade >= 9 ? '9_10' : '6_8', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 }, board_mode: 'board' });
const alwaysFlags = (check, rule, n = 1) => ({
  id: check, name: `always-${check}`, hard: true, modes: ['board'], LIMITS: {},
  run: (ex) => ({ ok: false, issues: leaves(ex).slice(0, n).map((q) => issue(check, rule, q.ref, 'planted', true)) }),
});

async function write(grade, check, rule, n = 1) {
  const row = rowFor(grade);
  const { d } = makeDeps({ grade, row, levels: variant.cognitive_split.levels, style: variant.scheme_style });
  d.checks = { run: makeRun([...MEMBERS, alwaysFlags(check, rule, n)]) };
  d.logToFile = () => {};
  return writeBoardPaper({ grade, subject: 'physics', pattern: 'fbise_ssc1_2027', P: fictionalEntry(), variant, requestId: 'r1' }, d).catch((e) => e);
}

test('G9: a D18 flaw left after every rewrite ships the paper with a last-try note', async () => {
  const res = await write(9, 'D18', 'KEY_LONGEST');
  expect(res.code).toBeUndefined();
  const { record, shortfall, notes } = res.examJson._meta.checks;
  expect(shortfall).toEqual([]);
  expect(record.hard).toBe(0);
  expect(record.shipped_last_try).toMatchObject({ 'D18 KEY_LONGEST': 1 });
  expect(notes.filter((n) => n.last_try)).toEqual([expect.objectContaining({ check: 'D18', paper_level: true })]);
});

test('G8: the same flaw still fails PATTERN_SHORT_SLOT', async () => {
  const res = await write(8, 'D18', 'KEY_LONGEST');
  expect(res.code).toBe('PATTERN_SHORT_SLOT');
});

test('G9: a flaw off the soft list (N20) still fails PATTERN_SHORT_SLOT', async () => {
  const res = await write(9, 'N20', 'FIGURE');
  expect(res.code).toBe('PATTERN_SHORT_SLOT');
});

// bd-qyi45h.5: the fictional paper generates 8 questions, so 2 flagged is 25% (over the 20% cap) and 3 key leaks is over 2.
test('G9: two D18 flaws on an 8-question paper are over the 20% cap and fail TOO_MANY_FLAWS, items kept', async () => {
  const res = await write(9, 'D18', 'KEY_LONGEST', 2);
  expect(res.code).toBe('TOO_MANY_FLAWS');
  expect(res.shortfall.flatMap((r) => r.items)).toHaveLength(2);
});

test('G9: three key leaks (N18 KEY_IN_STEM) fail TOO_MANY_FLAWS', async () => {
  const res = await write(9, 'N18', 'KEY_IN_STEM', 3);
  expect(res.code).toBe('TOO_MANY_FLAWS');
});
