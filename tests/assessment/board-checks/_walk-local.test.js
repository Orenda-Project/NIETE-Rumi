const { walk, leaves } = require('../../../bot/shared/services/assessment/board-checks/_walk-local');

const layout = { sections: [{ id: 'A', slots: [{ slot: 's.A.Q1', type: 'mcq', print_words: true }] }, { id: 'B', slots: [{ slot: 's.B.Q2', type: 'srq' }] }] };
const paper = {
  _layout: layout,
  unseen: {
    objective: { MCQs: [{ id: 'a', slot: 's.A.Q1', type: 'mcq' }, { id: 'b', slot: 's.A.Q1', type: 'mcq', removed: true }, { id: 'c', slot: 's.A.Q1', type: 'mcq' }] },
    subjective: {
      Short: [
        { id: 'o', slot: 's.B.Q2', type: 'srq', or: [{ id: 'o1', type: 'srq' }, { id: 'o2', type: 'srq' }] },
        { id: 'p', slot: 's.B.Q2', type: 'erq', parts: [{ id: 'p1', type: 'erq' }, { id: 'p2', type: 'erq' }] },
        { id: 'g', slot: 's.B.Q2', type: 'scenario', stimulus: { text: 'T', items: [{ id: 'g1', type: 'mcq' }, { id: 'g2', type: 'mcq' }] } },
        { id: 'h', slot: 's.B.Q2', type: 'scenario', stimulus: 'Plain', parts: [{ id: 'h1', type: 'mcq' }] },
      ],
    },
  },
};

describe('_walk-local', () => {
  const ls = leaves(paper);
  const byId = Object.fromEntries(ls.map((l) => [l.item.id, l]));
  test('skips removed items and containers', () => {
    expect(ls.map((l) => l.item.id)).toEqual(['a', 'c', 'o1', 'o2', 'p1', 'p2', 'g1', 'g2', 'h1']);
  });
  test('refs are slot#n with branch, part and stimulus suffixes', () => {
    expect(byId.a.ref).toBe('s.A.Q1#1');
    expect(byId.c.ref).toBe('s.A.Q1#2');
    expect(byId.o1.ref).toBe('s.B.Q2#1/a');
    expect(byId.o2.ref).toBe('s.B.Q2#1/b');
    expect(byId.p2.ref).toBe('s.B.Q2#2.p2');
    expect(byId.g1.ref).toBe('s.B.Q2#3@s1');
    expect(byId.g2.ref).toBe('s.B.Q2#4@s1');
    expect(byId.h1.ref).toBe('s.B.Q2#5.p1@s2');
  });
  test('refs are unique per leaf', () => {
    const refs = ls.map((l) => l.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });
  test('joins the layout slot row and section id', () => {
    expect(byId.a.slotRow.print_words).toBe(true);
    expect(byId.a.sectionId).toBe('A');
    expect(byId.o1.sectionId).toBe('B');
  });
  test('stimulus text reaches the leaves, string or object', () => {
    expect(byId.g1.stimulusText).toBe('T');
    expect(byId.h1.stimulusText).toBe('Plain');
  });
  test('free refs use the type', () => {
    const free = leaves({ unseen: { objective: { M: [{ id: 'x', type: 'mcq' }, { id: 'y', type: 'mcq' }] } } });
    expect(free.map((l) => l.ref)).toEqual(['mcq#1', 'mcq#2']);
  });
  test('walk with containers yields them flagged', () => {
    const all = walk(paper);
    expect(all.filter((n) => n.container).map((n) => n.item.id)).toEqual(['o', 'p', 'g', 'h']);
  });
  test('tolerates an empty or odd tree', () => {
    expect(leaves({})).toEqual([]);
    expect(leaves(null)).toEqual([]);
    expect(leaves({ unseen: { objective: { M: 'x' } } })).toEqual([]);
  });
});
