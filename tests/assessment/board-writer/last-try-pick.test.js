'use strict';
/**
 * bd-qyi45h.13: prod G11 CS paper 77af5907 (13 Nov) failed TOO_MANY_FLAWS. The writer kept the restore try (D18 1 +
 * N18 3, over the 2-leak cap) because an earlier rewrite (D18 1 + N18 2) still counted its held review flags as hard;
 * only the restore and originals had been through the final soften. Every try is now softened the same way before one
 * is picked, and a try that can ship within the cap wins over one that cannot.
 */
const SN = require('../../../bot/shared/services/assessment/board-6-12/ship-notes');

const SLOTS = [{ slot: 'A.Q1', generate: 20 }];
const row = (check, ids) => ({ slot: 'A.Q1', reason: check, items: ids, item_refs: ids, why: Object.fromEntries(ids.map((id) => [id, check])), hard: true });
const reviewRow = (ids) => ({ ...row('review', ids), review: Object.fromEntries(ids.map((id) => [id, { faults: ['key_given_away'], why: 'x' }])) });
const tryOf = (name, rows, hardRules) => ({
  name, ex: {},
  checks: { shortfall: rows, notes: [], record: { hard: rows.reduce((n, r) => n + r.items.length, 0), hard_rules: hardRules, per_check: {} } },
});
const ctx = (short = []) => ({ grade: 11, slots: SLOTS, shortOf: () => short, groupsOf: () => new Set() });

test('a rewrite with held review flags is softened before the pick and beats an over-cap restore', () => {
  const restore = tryOf('restore', [row('D18', ['A.Q1#1']), row('N18', ['A.Q1#2', 'A.Q1#3', 'A.Q1#4'])], { 'D18 KEY_LONGEST': 1, 'N18 KEY_IN_STEM': 3 });
  const rewrite = tryOf('rewrite 5', [row('D18', ['A.Q1#1']), row('N18', ['A.Q1#2', 'A.Q1#3']), reviewRow(['A.Q1#5', 'A.Q1#6', 'A.Q1#7', 'A.Q1#8'])], { 'D18 KEY_LONGEST': 1, 'N18 KEY_IN_STEM': 2 });
  const best = SN.pickLast([restore, rewrite], ctx());
  expect(best.name).toBe('rewrite 5');
  expect(best.checks.record.hard).toBe(3);
  expect(best.checks.notes.filter((n) => n.check === 'review')).toHaveLength(4);
});

test('a shippable try wins over one with fewer hard issues that cannot ship', () => {
  const numeric = tryOf('rewrite 1', [row('D16', ['A.Q1#1'])], { 'D16 NO_RESOLVE': 1 });
  const soft = tryOf('restore', [row('D18', ['A.Q1#1', 'A.Q1#2'])], { 'D18 KEY_LONGEST': 2 });
  expect(SN.pickLast([numeric, soft], ctx()).name).toBe('restore');
});

test('a clean try wins over a shippable one', () => {
  const soft = tryOf('rewrite 1', [row('D18', ['A.Q1#1'])], { 'D18 KEY_LONGEST': 1 });
  const clean = tryOf('restore', [reviewRow(['A.Q1#2'])], {});
  const best = SN.pickLast([soft, clean], ctx());
  expect(best.name).toBe('restore');
  expect(best.checks.shortfall).toEqual([]);
});

test('with nothing shippable the fewest hard issues still win, first on a tie', () => {
  const a = tryOf('rewrite 2', [row('D16', ['A.Q1#1', 'A.Q1#2'])], {});
  const b = tryOf('rewrite 1', [row('D16', ['A.Q1#1'])], {});
  const c = tryOf('restore', [row('D16', ['A.Q1#3'])], {});
  expect(SN.pickLast([a, b, c], ctx()).name).toBe('rewrite 1');
});

test('a short slot keeps a try from shipping', () => {
  const soft = tryOf('restore', [row('D18', ['A.Q1#1'])], { 'D18 KEY_LONGEST': 1 });
  const hard = tryOf('rewrite 1', [row('D16', ['A.Q1#1']), row('D16', ['A.Q1#2'])], {});
  expect(SN.pickLast([hard, soft], ctx([{ slot: 'A.Q1', need: 20, have: 19 }])).name).toBe('restore');
});
