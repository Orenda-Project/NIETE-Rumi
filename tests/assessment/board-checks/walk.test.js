'use strict';
const { leaves, topNodes, isGroup } = require('../../../bot/shared/services/assessment/board-checks/walk');
const { mcq, srq, row, paper, deepFreeze } = require('./paper-builder');
const B = require('./paper-builder');

describe('walk.leaves', () => {
  test('joins each leaf to its layout slot row and section; ref = slot#n', () => {
    const p = paper({
      sections: [{ id: 'A', marks: 2, slots: [row('s.A.Q1', { attempt: 2, printed: 2 })] }],
      items: [mcq('q1', 's.A.Q1', 'A'), mcq('q2', 's.A.Q1', 'B')],
    });
    const out = leaves(deepFreeze(p));
    expect(out.map((l) => l.ref)).toEqual(['s.A.Q1#1', 's.A.Q1#2']);
    expect(out[0].sectionId).toBe('A');
    expect(out[0].slot).toBe('s.A.Q1');
  });

  test('descends or[] branches (/a /b), parts[] (.pK) and stimulus groups (@sK)', () => {
    const or = { id: 'o1', slot: 's.B.Q2', or: [srq('a', 's.B.Q2', 4), srq('b', 's.B.Q2', 4)] };
    const parts = { id: 'p1', slot: 's.B.Q3', type: 'srq', marks: 6, parts: [srq('p1a', 's.B.Q3', 3), srq('p1b', 's.B.Q3', 3)] };
    const grp = { id: 'g1', slot: 's.A.Q1', type: 'mcq', stimulus: { text: 'Passage', items: [mcq('m1', 's.A.Q1', 'A'), mcq('m2', 's.A.Q1', 'B')] } };
    const p = paper({
      sections: [
        { id: 'A', marks: 2, slots: [row('s.A.Q1', { stimulus: { count: 1, mcqs_per_stimulus: 2 } })] },
        { id: 'B', marks: 10, slots: [row('s.B.Q2', { type: 'srq', marks_each: 4 }), row('s.B.Q3', { type: 'srq', marks_each: 6 })] },
      ],
      items: [grp, { ...or, type: 'srq' }, parts],
    });
    const refs = leaves(p).map((l) => l.ref);
    expect(refs).toEqual(['s.A.Q1#1@s1', 's.A.Q1#1@s2', 's.B.Q2#1/a', 's.B.Q2#1/b', 's.B.Q3#1.p1', 's.B.Q3#1.p2']);
    expect(leaves(p)[0].stimulus).toBe('Passage');
    expect(new Set(refs).size).toBe(refs.length);
  });

  test('skips removed items and teacher_marked slots (but topNodes still sees them)', () => {
    const p = paper({
      sections: [{ id: 'A', marks: 1, slots: [row('s.A.Q1'), row('s.A.Q2', { teacher_marked: true })] }],
      items: [mcq('q1', 's.A.Q1', 'A'), mcq('q2', 's.A.Q1', 'B', null, { removed: true }), srq('t1', 's.A.Q2', 1)],
    });
    expect(leaves(p).map((l) => l.item.id)).toEqual(['q1']);
    expect(topNodes(p).map((n) => n.item.id)).toEqual(['q1', 't1']);
  });

  test('free mode: no _layout, ref = type#n, per type', () => {
    const p = { unseen: { objective: { MCQ: [{ id: 'a', type: 'mcq', options: ['A) 1'] }, { id: 'b', type: 'mcq', options: [] }] }, subjective: { S: [{ id: 'c', type: 'srq' }] } } };
    expect(leaves(p).map((l) => l.ref)).toEqual(['mcq#1', 'mcq#2', 'srq#1']);
  });

  test('walks seen + unseen and the map-of-lists (Long Question) shape; tolerates junk', () => {
    const p = { seen: { objective: { M: [mcq('a', 'x', 'A')] } }, unseen: { subjective: { Long: { Essay: [srq('b', 'x', 1)] } } } };
    expect(leaves(p).map((l) => l.item.id)).toEqual(['a', 'b']);
    expect(leaves(null)).toEqual([]);
    expect(leaves({ unseen: { objective: { M: [null, 3] } } })).toEqual([]);
  });

  test('isGroup is true only for a stimulus object with items[]', () => {
    expect(isGroup({ stimulus: { items: [] } })).toBe(true);
    expect(isGroup({ stimulus: 'text' })).toBe(false);
    expect(isGroup({})).toBe(false);
  });
});

test('paper-builder is exercised', () => {
  expect(B.ctxBoard().mode).toBe('board');
});
