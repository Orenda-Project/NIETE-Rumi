'use strict';
// bd-5jmnfj.38.33 (c): the key legend's MCQ mark, every printed MCQ/scenario item mark and each slot's marks_each agree.
// Fictional paper: the legend says 1 mark, the items and the slots say 1/2.
const M = require('../../../bot/shared/services/assessment/board-checks/mark-consistency');
const { mcq, row, paper, ctxBoard } = require('./paper-builder');

const legend = (mark) => ({ lines_en: [`MCQs: ${mark} for the filled bubble. Two bubbles = 0.`, 'other line'] });
const ctx = (mark, rows) => ctxBoard({ variant: { scheme_style: 'analytic_points', legend: legend(mark), sections: [{ id: 'A', slots: rows }] } });
const make = (marks, slotMark = 0.5, extraRows = []) => paper({
  sections: [{ id: 'A', marks: 2, slots: [row('s', { attempt: 2, printed: 2, marks_each: slotMark }), ...extraRows] }],
  items: [mcq('a', 's', 'A) 1', null, { marks }), mcq('b', 's', 'A) 1', null, { marks })],
});
const rulesOf = (r) => r.issues.map((i) => i.rule);

describe('D21 mark-consistency', () => {
  test('interface: hard, board mode only', () => {
    expect(M).toMatchObject({ id: 'D21', name: 'mark-consistency', hard: true, modes: ['board'] });
  });
  test('legend says 1 mark, items and slot say 1/2 -> LEGEND_MARK, hard', () => {
    const r = M.run(make(0.5), ctx('1 mark', [{ slot: 's', type: 'mcq', marks_each: 0.5 }]));
    expect(rulesOf(r)).toEqual(['LEGEND_MARK']);
    expect(r.issues[0].hard).toBe(true);
    expect(r.ok).toBe(false);
  });
  test('legend, slot and items all 1/2 -> clean', () => {
    expect(M.run(make(0.5), ctx('½ mark', [{ slot: 's', type: 'mcq', marks_each: 0.5 }])).issues).toEqual([]);
  });
  test('a printed item mark that differs from its slot -> ITEM_MARK on that item', () => {
    const r = M.run(make(1), ctx('½ mark', [{ slot: 's', type: 'mcq', marks_each: 0.5 }]));
    expect(r.issues.map((i) => [i.rule, i.item_ref])).toEqual([['ITEM_MARK', 's#1'], ['ITEM_MARK', 's#2']]);
  });
  test('a scenario slot with another marks_each than the MCQ slot is caught (not only the first mcq slot is read)', () => {
    const rows = [{ slot: 's', type: 'mcq', marks_each: 0.5 }, { slot: 'g', type: 'scenario', marks_each: 1 }];
    const r = M.run(make(0.5), ctx('½ mark', rows));
    expect(r.issues.map((i) => [i.rule, i.item_ref])).toEqual([['LEGEND_MARK', 'g']]);
    const bare = M.run(make(0.5), ctxBoard({ variant: { sections: [{ id: 'A', slots: rows }] } }));
    expect(bare.issues.map((i) => [i.rule, i.item_ref])).toEqual([['SLOT_MARK', 'g']]);
  });
  test('no legend or no variant slots: nothing to compare, no issue, never throws', () => {
    expect(M.run(make(0.5), ctxBoard()).issues).toEqual([]);
    expect(M.run(make(0.5), undefined).issues).toEqual([]);
  });
});
