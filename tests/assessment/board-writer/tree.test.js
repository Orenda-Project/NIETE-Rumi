'use strict';
const T = require('../../../bot/shared/services/assessment/board-6-12/tree');

const tag = { chapter: 1, section: null, code: 'x', page: 1, official_slo: null, blooms: 'K', difficulty: 'easy' };
const mcq = (id, slot, extra) => ({ id, slot, question: `q ${id}`, tag, ...extra });
const tree = (...items) => ({ unseen: { objective: { MCQs: items } } });
const slots = (...rows) => rows.map(([slot, generate, extra]) => ({ slot, generate, ...extra }));

describe('liveCounts / shortfallOf', () => {
  test('counts tagged leaves per slot', () => {
    const t = tree(mcq('1', 'S'), mcq('2', 'S'), mcq('3', 'T'));
    expect([...T.liveCounts(t)]).toEqual([['S', 2], ['T', 1]]);
  });
  test('an item without a tag is not live', () => {
    const t = tree(mcq('1', 'S'), { id: '2', slot: 'S', question: 'no tag' });
    expect(T.liveCounts(t).get('S')).toBe(1);
  });
  test('an OR node counts once when both branches are tagged, not when one is bare', () => {
    const ok = tree({ id: 'o', slot: 'S', or: [mcq('a', 'S'), mcq('b', 'S')] });
    const bad = tree({ id: 'o', slot: 'S', or: [mcq('a', 'S'), { id: 'b' }] });
    expect(T.liveCounts(ok).get('S')).toBe(1);
    expect(T.liveCounts(bad).get('S') || 0).toBe(0);
  });
  test('a stimulus group counts its tagged members', () => {
    const t = tree({ id: 'g', slot: 'S', stimulus: { text: 'passage', items: [mcq('a', 'S'), mcq('b', 'S'), { id: 'c' }] } });
    expect(T.liveCounts(t).get('S')).toBe(2);
  });
  test('a node with parts counts once when every part is tagged', () => {
    const ok = tree({ id: 'p', slot: 'S', parts: [mcq('a', 'S'), mcq('b', 'S')] });
    const bad = tree({ id: 'p', slot: 'S', parts: [mcq('a', 'S'), { id: 'b' }] });
    expect(T.liveCounts(ok).get('S')).toBe(1);
    expect(T.liveCounts(bad).get('S') || 0).toBe(0);
  });
  test('shortfallOf names slots below generate and skips slots that generate nothing', () => {
    const t = tree(mcq('1', 'S'));
    expect(T.shortfallOf(t, slots(['S', 3], ['U', 0], ['V', 1]))).toEqual([{ slot: 'S', have: 1, need: 3 }, { slot: 'V', have: 0, need: 1 }]);
  });
  test('shortfallOf is empty when every slot is met or exceeded', () => {
    expect(T.shortfallOf(tree(mcq('1', 'S'), mcq('2', 'S')), slots(['S', 2]))).toEqual([]);
    expect(T.shortfallOf(tree(mcq('1', 'S'), mcq('2', 'S'), mcq('3', 'S')), slots(['S', 2]))).toEqual([]);
  });
  test('a teacher-marked slot is never short', () => {
    expect(T.shortfallOf(tree(), slots(['P', 2, { teacher_marked: true }]))).toEqual([]);
  });
});

describe('trimExcess', () => {
  test('drops top-level nodes beyond generate, keeping the first ones', () => {
    const t = tree(mcq('1', 'S'), mcq('2', 'S'), mcq('3', 'S'), mcq('4', 'T'));
    T.trimExcess(t, slots(['S', 2], ['T', 1]));
    expect(t.unseen.objective.MCQs.map((q) => q.id)).toEqual(['1', '2', '4']);
  });
  test('a stimulus slot is trimmed by group count', () => {
    const g = (id) => ({ id, slot: 'S', stimulus: { text: 't', items: [mcq(`${id}a`, 'S')] } });
    const t = tree(g('g1'), g('g2'), g('g3'));
    T.trimExcess(t, slots(['S', 2, { stimulus: { count: 2, mcqs_per_stimulus: 1 } }]));
    expect(t.unseen.objective.MCQs.map((q) => q.id)).toEqual(['g1', 'g2']);
  });
  test('items of unknown slots are left alone', () => {
    const t = tree(mcq('1', 'Z'), mcq('2', 'Z'));
    T.trimExcess(t, slots(['S', 1]));
    expect(t.unseen.objective.MCQs).toHaveLength(2);
  });
});

describe('dropIds', () => {
  test('removes the top node that holds a leaf with the id, even inside OR or stimulus', () => {
    const t = tree(mcq('1', 'S'), { id: 'o', slot: 'S', or: [mcq('a', 'S'), mcq('b', 'S')] }, { id: 'g', slot: 'S', stimulus: { text: 't', items: [mcq('c', 'S')] } });
    const dropped = T.dropIds(t, new Set(['b', 'c']));
    expect(t.unseen.objective.MCQs.map((q) => q.id)).toEqual(['1']);
    expect(dropped).toBe(2);
  });
  test('an id that is not there drops nothing', () => {
    const t = tree(mcq('1', 'S'));
    expect(T.dropIds(t, new Set(['zz']))).toBe(0);
    expect(t.unseen.objective.MCQs).toHaveLength(1);
  });
});

describe('stamp', () => {
  const S = [{ slot: 'S', type: 'srq', or: { branches: [{ type: 'srq' }, { type: 'erq' }] } }, { slot: 'M', type: 'mcq' }];
  test('sets type from the slot on every leaf, OR branches from their own type, and fills a missing id', () => {
    const t = tree({ slot: 'S', or: [{ tag }, { tag }] }, { slot: 'M', type: 'wrong', blooms: 'U', question: 'q', tag }, { slot: 'M', stimulus: { text: 't', items: [{ tag }] } });
    T.stamp(t, S, (item) => item);
    const [o, m, g] = t.unseen.objective.MCQs;
    expect(o.or.map((b) => b.type)).toEqual(['srq', 'erq']);
    expect(m.type).toBe('mcq');
    expect('blooms' in m).toBe(false);
    expect(g.stimulus.items[0].type).toBe('mcq');
    expect(o.id).toBe('S#1');
    expect(m.id).toBe('M#1');
    expect(g.id).toBe('M#2');
    expect(o.or[0].id).toBe('S#1/a');
    expect(g.stimulus.items[0].id).toBe('M#2@s1');
  });
  test('keeps an id the model wrote and runs the slo stamper on each top node', () => {
    const seen = [];
    const t = tree({ id: 'mine', slot: 'M', tag });
    T.stamp(t, S, (item) => { seen.push(item.id); return item; });
    expect(t.unseen.objective.MCQs[0].id).toBe('mine');
    expect(seen).toEqual(['mine']);
  });
  test('uses the stamper return value when it returns a new object', () => {
    const t = tree({ id: 'm', slot: 'M', tag });
    T.stamp(t, S, (item) => ({ ...item, tag: { ...item.tag, official_slo: 'X' } }));
    expect(t.unseen.objective.MCQs[0].tag.official_slo).toBe('X');
  });
  test('fills kind null and marks from the slot, keeps what the model wrote', () => {
    const rows = [{ slot: 'M', type: 'mcq', marks_each: 2 }, { slot: 'S', type: 'srq', marks_each: 5, or: { branches: [{ type: 'srq', marks_each: 5 }, { type: 'srq', marks_each: 5 }] } }];
    const t = tree({ slot: 'M', tag }, { slot: 'M', kind: 'open', marks: 9, tag }, { slot: 'S', or: [{ tag }, { tag, marks: 4 }] }, { slot: 'M', stimulus: { text: 't', items: [{ tag }] } });
    T.stamp(t, rows, (x) => x);
    const [a, b, o, g] = t.unseen.objective.MCQs;
    expect([a.kind, a.marks]).toEqual([null, 2]);
    expect([b.kind, b.marks]).toEqual(['open', 9]);
    expect(o.or.map((x) => x.marks)).toEqual([5, 4]);
    expect(g.stimulus.items[0].marks).toBe(2);
  });
  test('a new id never repeats one already in the tree (a dropped item leaves a gap)', () => {
    const t = tree({ id: 'M#1', slot: 'M', tag }, { id: 'M#3', slot: 'M', tag }, { slot: 'M', tag }, { slot: 'M', tag });
    T.stamp(t, S, (x) => x);
    expect(t.unseen.objective.MCQs.map((q) => q.id)).toEqual(['M#1', 'M#3', 'M#2', 'M#4']);
  });
  test('an item whose slot is unknown is left as it is', () => {
    const t = tree({ id: 'z', slot: 'ZZ', type: 'keep', tag });
    T.stamp(t, S, () => { throw new Error('should not run'); });
    expect(t.unseen.objective.MCQs[0].type).toBe('keep');
  });
});

describe('leavesOf', () => {
  test('flattens OR, parts and stimulus members', () => {
    const t = tree(mcq('1', 'S'), { id: 'o', slot: 'S', or: [mcq('a', 'S'), mcq('b', 'S')] }, { id: 'p', slot: 'S', parts: [mcq('p1', 'S'), mcq('p2', 'S')] }, { id: 'g', slot: 'S', stimulus: { text: 't', items: [mcq('c', 'S')] } });
    expect(T.leavesOf(t).map((l) => l.id)).toEqual(['1', 'a', 'b', 'p1', 'p2', 'c']);
  });
});
