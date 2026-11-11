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
