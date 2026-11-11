'use strict';
/**
 * bd-qyi45h.3 (Amena, 11 Nov 2026, option a): a G9-12 board paper whose last try is complete and fails only on
 * question-quality checks (D12 level over quota, D18 key stands out, N18 key in a stem) ships with paper-level notes
 * instead of failing. Anything else (a short slot, wrong totals, a numeric answer) still fails.
 */
const LT = require('../../../bot/shared/services/assessment/board-6-12/last-try');

const checks = (rows, hardRules) => ({
  shortfall: rows,
  notes: [],
  record: { hard: rows.reduce((n, r) => n + r.items.length, 0), hard_rules: hardRules, per_check: {} },
});
const row = (slot, reason, ids) => ({ slot, reason, items: ids, item_refs: ids, why: Object.fromEntries(ids.map((id) => [id, reason])), hard: true });

describe('canShip', () => {
  test('G11 CS re-send 2: D12 LEVEL_OVER x2, D18 KEY_LONGEST, N18 KEY_IN_STEM on a full G11 paper ships', () => {
    const c = checks([row('A.Q1', 'D12', ['A.Q1#1', 'A.Q1#2']), row('A.Q2', 'D18', ['A.Q2#1']), row('B.Q3', 'N18', ['B.Q3#1'])],
      { 'D12 LEVEL_OVER': 2, 'D18 KEY_LONGEST': 1, 'N18 KEY_IN_STEM': 1 });
    expect(LT.canShip(c, { grade: 11, slotsShort: [] })).toBe(true);
  });
  test('grades 9 and 12 qualify; 6, 7 and 8 do not', () => {
    const c = () => checks([row('A.Q1', 'D12', ['A.Q1#1'])], { 'D12 LEVEL_OVER': 1 });
    expect([6, 7, 8, 9, 12].map((grade) => LT.canShip(c(), { grade, slotsShort: [] }))).toEqual([false, false, false, true, true]);
  });
  test('a slot short of questions never ships', () => {
    const c = checks([row('A.Q1', 'D12', ['A.Q1#1'])], { 'D12 LEVEL_OVER': 1 });
    expect(LT.canShip(c, { grade: 10, slotsShort: [{ slot: 'A.Q1', need: 4, have: 3 }] })).toBe(false);
  });
  test('a D12 rule other than LEVEL_OVER (e.g. wrong totals) does not ship', () => {
    const c = checks([row('A.Q1', 'D12', ['A.Q1#1'])], { 'D12 LEVEL_OVER': 1, 'D12 TOTAL': 1 });
    expect(LT.canShip(c, { grade: 10, slotsShort: [] })).toBe(false);
  });
  test('an N18 rule other than KEY_IN_STEM does not ship', () => {
    const c = checks([row('A.Q1', 'N18', ['A.Q1#1'])], { 'N18 OTHER': 1 });
    expect(LT.canShip(c, { grade: 10, slotsShort: [] })).toBe(false);
  });
  test('any other check left (e.g. a numeric answer) does not ship', () => {
    const c = checks([row('A.Q1', 'D12', ['A.Q1#1']), row('B.Q2', 'N12', ['B.Q2#1'])], { 'D12 LEVEL_OVER': 1, 'N12 NUMERIC': 1 });
    expect(LT.canShip(c, { grade: 10, slotsShort: [] })).toBe(false);
  });
  test('a row with no item ids (a whole-slot issue) does not ship', () => {
    const c = checks([{ slot: 'A.Q1', reason: 'D12', items: [], item_refs: ['A.Q1'], hard: true }], { 'D12 LEVEL_OVER': 1 });
    expect(LT.canShip(c, { grade: 10, slotsShort: [] })).toBe(false);
  });
  test('rules a check already released (D22) do not block it', () => {
    const c = checks([row('A.Q1', 'D18', ['A.Q1#1'])], { 'D18 KEY_LONGEST': 1, 'D22 ANSWER_ONLY': 2 });
    expect(LT.canShip(c, { grade: 9, slotsShort: [] })).toBe(true);
  });
  test('nothing failing: nothing to ship', () => {
    expect(LT.canShip(checks([], {}), { grade: 9, slotsShort: [] })).toBe(false);
  });
});

describe('ship', () => {
  test('every item left becomes a paper-level last-try note; shortfall empties; hard goes to 0; the rules are kept', () => {
    const c = checks([row('A.Q1', 'D12', ['A.Q1#1']), row('B.Q3', 'N18', ['B.Q3#1'])], { 'D12 LEVEL_OVER': 1, 'N18 KEY_IN_STEM': 1 });
    LT.ship(c);
    expect(c.shortfall).toEqual([]);
    expect(c.record.hard).toBe(0);
    expect(c.record.shipped_last_try).toEqual({ 'D12 LEVEL_OVER': 1, 'N18 KEY_IN_STEM': 1 });
    expect(c.notes).toEqual([
      { check: 'D12', id: 'A.Q1#1', slot: 'A.Q1', msg: LT.MSG.D12, paper_level: true, last_try: true },
      { check: 'N18', id: 'B.Q3#1', slot: 'B.Q3', msg: LT.MSG.N18, paper_level: true, last_try: true },
    ]);
  });
});

/**
 * bd-qyi45h.5: a last-try paper ships only while its flaws are few. More than 2 questions whose
 * answer shows in another question (N18), or more than 20% of the paper's questions flagged (each counted once), and it
 * fails as TOO_MANY_FLAWS, a code of its own so the teacher is told why.
 */
describe('overCap', () => {
  const slots = (n) => [{ slot: 'A.Q1', generate: n - 10 }, { slot: 'B.Q2', generate: 10 }];
  test('the paper total is the slots it generates', () => {
    expect(LT.itemTotal(slots(89))).toBe(89);
  });
  test('G11 CS, 11 Nov: 11 flagged of 89 (12%) with one key leak ships', () => {
    const ids = (p, n) => Array.from({ length: n }, (_, i) => `${p}#${i + 1}`);
    const c = checks([row('A.Q1', 'D12', ids('A.Q1', 9)), row('A.Q2', 'D18', ['A.Q2#1']), row('B.Q2', 'N18', ['B.Q2#1'])], {});
    expect(LT.overCap(c, slots(89))).toBeNull();
  });
  test('G9 Physics, 11 Nov: two key leaks is at the cap and ships', () => {
    const c = checks([row('A.Q1', 'D18', ['A.Q1#1']), row('A.Q2', 'N18', ['A.Q2#1', 'A.Q2#2'])], {});
    expect(LT.overCap(c, slots(68))).toBeNull();
  });
  test('a third key leak fails the paper', () => {
    const c = checks([row('A.Q2', 'N18', ['A.Q2#1', 'A.Q2#2', 'A.Q2#3'])], {});
    expect(LT.overCap(c, slots(68))).toEqual({ code: 'TOO_MANY_FLAWS', keyLeaks: 3, flagged: 3, total: 68 });
  });
  test('20% flagged ships; one more fails', () => {
    const ids = (n) => Array.from({ length: n }, (_, i) => `A.Q1#${i + 1}`);
    expect(LT.overCap(checks([row('A.Q1', 'D12', ids(10))], {}), slots(50))).toBeNull();
    expect(LT.overCap(checks([row('A.Q1', 'D12', ids(11))], {}), slots(50))).toEqual({ code: 'TOO_MANY_FLAWS', keyLeaks: 0, flagged: 11, total: 50 });
  });
  test('a question flagged twice counts once', () => {
    const ids = (n) => Array.from({ length: n }, (_, i) => `A.Q1#${i + 1}`);
    const c = checks([row('A.Q1', 'D12', ids(10)), row('A.Q1', 'D18', ids(10))], {});
    expect(LT.overCap(c, slots(50))).toBeNull();
  });
  test('the caps are 2 key leaks and 20%', () => {
    expect([LT.CAP.keyLeaks, LT.CAP.share]).toEqual([2, 0.2]);
  });
});
