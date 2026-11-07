'use strict';
/** ship-notes: the writer's final pass turns leftover review flags and D22 items into paper-level notes (Amena, 7 Nov 2026). */
const SN = require('../../../bot/shared/services/assessment/board-6-12/ship-notes');
const MM = require('../../../bot/shared/services/assessment/board-checks/method-marks');

const make = () => ({
  shortfall: [
    { slot: 'B.Q2', reason: 'D22', items: ['B.Q2#1', 'B.Q2#2'], item_refs: ['r1', 'r2'], why: { 'B.Q2#1': 'D22', 'B.Q2#2': 'D9' }, hard: true },
    { slot: 'B.Q3', reason: 'D22', items: ['B.Q3#1'], item_refs: ['r3'], why: { 'B.Q3#1': 'D22' }, hard: true },
  ],
  notes: [],
  record: { hard: 3, per_check: { 'method-marks': { issues: 2, hard: 2 }, D9: { issues: 1, hard: 1 } } },
});

describe('release', () => {
  test('moves only D22 items to paper-level notes, keeps other hard items, and recounts hard', () => {
    const c = SN.release(make(), SN.SHIPPED[0]);
    expect(c.shortfall).toHaveLength(1);
    expect(c.shortfall[0]).toMatchObject({ slot: 'B.Q2', items: ['B.Q2#2'], why: { 'B.Q2#2': 'D9' } });
    expect(c.notes).toEqual([
      { check: 'D22', id: 'B.Q2#1', slot: 'B.Q2', msg: MM.MSG, paper_level: true },
      { check: 'D22', id: 'B.Q3#1', slot: 'B.Q3', msg: MM.MSG, paper_level: true },
    ]);
    expect(c.record.hard).toBe(1);
    expect(c.record.per_check['method-marks'].hard).toBe(0);
  });
  test('without a per_check count it subtracts the items moved', () => {
    const c = make();
    delete c.record.per_check;
    expect(SN.release(c, SN.SHIPPED[0]).record.hard).toBe(1);
  });
  test('nothing to release leaves checks as they were', () => {
    const c = { shortfall: [], notes: [], record: { hard: 0, per_check: {} } };
    expect(SN.release(c, SN.SHIPPED[0])).toEqual({ shortfall: [], notes: [], record: { hard: 0, per_check: {} } });
  });
});

describe('finalSoften', () => {
  test('review flags (MR.soften, final) and D22 both ship as paper-level notes', () => {
    const c = {
      shortfall: [
        { slot: 'A.Q1', reason: 'review', items: ['A.Q1#2'], item_refs: ['a'], why: { 'A.Q1#2': 'review' }, review: { 'A.Q1#2': { faults: ['key_given_away'], why: 'x' } }, hard: true },
        { slot: 'B.Q3', reason: 'D22', items: ['B.Q3#1'], item_refs: ['r3'], why: { 'B.Q3#1': 'D22' }, hard: true },
      ],
      notes: [],
      record: { hard: 2, per_check: { review: { hard: 1 }, 'method-marks': { hard: 1 } } },
    };
    SN.finalSoften(c, new Set());
    expect(c.shortfall).toEqual([]);
    expect(c.record.hard).toBe(0);
    expect(c.notes.map((n) => [n.check, n.paper_level])).toEqual([['review', true], ['D22', true]]);
  });
  test('SHIPPED names D22 method-marks with its message', () => {
    expect(SN.SHIPPED).toEqual([{ check: 'D22', name: 'method-marks', msg: MM.MSG }]);
  });
});
