'use strict';
// bd-5jmnfj.38.30 r9 (A6b): a top-up or rewrite of a slot is told the levels the slot still owes. Fictional items.
const { owed } = require('../../../bot/shared/services/assessment/board-6-12/slot-quota');

const lv = { K: 30, U: 50, A: 20 };
const it = (slot, b) => ({ slot, question: 'q', tag: { blooms: b } });
const tree = (...items) => ({ unseen: { subjective: { srq: items } } });
const slot = { slot: 'B.Q2', type: 'srq', generate: 6, printed: 6, attempt: 6, marks_each: 2 };

describe('owed', () => {
  test('K 2 and U 1 live of a 6-item slot: a rewrite of 3 is told U 2, A 1', () => {
    expect(owed(slot, tree(it('B.Q2', 'K'), it('B.Q2', 'K'), it('B.Q2', 'U'), it('C.Q1', 'U')), lv, 3)).toEqual({ K: 0, U: 2, A: 1 });
  });
  test('an OR node counts by its first branch, deficits fill from the top level down; an empty tree owes the slot quota scaled to n', () => {
    const or = { slot: 'B.Q2', or: [{ tag: { blooms: 'A' } }, { tag: { blooms: 'A' } }] };
    expect(owed(slot, tree(or), lv, 2)).toEqual({ K: 0, U: 2, A: 0 });
    expect(owed(slot, null, lv, 6)).toEqual({ K: 2, U: 3, A: 1 });
  });
  test('no split -> null (no quota)', () => {
    expect(owed(slot, tree(), null, 2)).toBeNull();
  });
  test('a stimulus slot counts its member items: 4 K members live of 8 -> a rewrite of 4 is told U 2, A 2', () => {
    const st = { ...slot, type: 'scenario', generate: 8, stimulus: { count: 2, mcqs_per_stimulus: 4 } };
    const group = { slot: 'B.Q2', stimulus: { text: 't', items: ['K', 'K', 'K', 'K'].map((b) => ({ tag: { blooms: b } })) } };
    expect(owed(st, tree(group), lv, 4)).toEqual({ K: 0, U: 2, A: 2 });
  });
});
