'use strict';
// bd-5jmnfj.38.30 round 10: the key must not stand out. Fictional items, modelled on a panel finding (key longest
// and carrying "never").
const M = require('../../../bot/shared/services/assessment/board-checks/key-cue');
const { mcq, row, paper, ctxBoard, deepFreeze } = require('./paper-builder');

const one = (items) => M.run(paper({ sections: [{ id: 'A', marks: items.length, slots: [row('s', { attempt: items.length, printed: items.length })] }], items }), ctxBoard());

describe('D18 key-cue: the key stands out', () => {
  test('interface: hard, board mode only', () => {
    expect(M).toMatchObject({ id: 'D18', name: 'key-cue', hard: true, modes: ['board'] });
  });
  test('key far longer than every distractor -> KEY_LONGEST, hard', () => {
    const it = mcq('a', 's', 'C) a body keeps moving at the same speed in a straight line', ['A) it stops', 'B) it turns', 'C) a body keeps moving at the same speed in a straight line', 'D) it falls']);
    const r = one(deepFreeze([it]));
    expect(r.issues).toEqual([expect.objectContaining({ check: 'D18', rule: 'KEY_LONGEST', item_ref: 's#1', hard: true })]);
  });
  test('key carrying always/never -> KEY_ABSOLUTE, hard', () => {
    const it = mcq('a', 's', 'B) never changes', ['A) grows fast', 'B) never changes', 'C) halves daily', 'D) doubles soon']);
    expect(one([it]).issues.map((i) => [i.rule, i.hard])).toEqual([['KEY_ABSOLUTE', true]]);
  });
  test('a distractor carrying always/never is a soft note', () => {
    const it = mcq('a', 's', 'B) speed', ['A) always mass', 'B) speed', 'C) force', 'D) weight']);
    expect(one([it]).issues.map((i) => [i.rule, i.hard])).toEqual([['DISTRACTOR_ABSOLUTE', false]]);
  });
  test('options of similar length, numbers and a slightly longer key pass', () => {
    const a = mcq('a', 's', 'C) velocity', ['A) speed', 'B) distance', 'C) velocity', 'D) time']);
    const b = mcq('b', 's', 'D) 40', ['A) 10', 'B) 20', 'C) 30', 'D) 40']);
    const c = mcq('c', 's', 'A) the rate of change of velocity', ['A) the rate of change of velocity', 'B) the rate of change of distance', 'C) the total distance', 'D) the area under a curve']);
    expect(one([a, b, c]).issues).toEqual([]);
  });
});
