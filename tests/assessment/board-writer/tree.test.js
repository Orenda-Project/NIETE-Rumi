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
    expect([b.kind, b.marks]).toEqual([null, 9]);
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
  test('kind is code-owned outside srq/erq: an MCQ or an off-list kind becomes null, a listed srq kind stays', () => {
    const rows = [{ slot: 'M', type: 'mcq', marks_each: 1 }, { slot: 'S', type: 'srq', marks_each: 3 }];
    const t = tree({ slot: 'M', kind: 'recall', tag }, { slot: 'S', kind: 'explain', tag }, { slot: 'S', kind: 'reason', tag }, { slot: 'M', stimulus: { text: 't', items: [{ kind: 'interpret', tag }] } });
    T.stamp(t, rows, (x) => x);
    const [m, bad, ok, g] = t.unseen.objective.MCQs;
    expect([m.kind, bad.kind, ok.kind, g.stimulus.items[0].kind]).toEqual([null, null, 'reason', null]);
  });
  test('the slo stamper reaches every leaf: stimulus members, OR branches and parts, not only top nodes', () => {
    const rows = [{ slot: 'M', type: 'mcq', marks_each: 1 }, { slot: 'S', type: 'srq', marks_each: 3 }];
    const t = tree({ slot: 'M', stimulus: { text: 't', items: [{ tag: { ...tag } }, { tag: { ...tag } }] } }, { slot: 'S', or: [{ tag: { ...tag } }, { tag: { ...tag } }] }, { slot: 'S', parts: [{ tag: { ...tag } }] });
    T.stamp(t, rows, (x) => ({ ...x, tag: { ...x.tag, official_slo: 'X' } }));
    const leaves = T.leavesOf(t);
    expect(leaves).toHaveLength(5);
    leaves.forEach((l) => expect(l.tag.official_slo).toBe('X'));
  });
});

describe('leavesOf', () => {
  test('flattens OR, parts and stimulus members', () => {
    const t = tree(mcq('1', 'S'), { id: 'o', slot: 'S', or: [mcq('a', 'S'), mcq('b', 'S')] }, { id: 'p', slot: 'S', parts: [mcq('p1', 'S'), mcq('p2', 'S')] }, { id: 'g', slot: 'S', stimulus: { text: 't', items: [mcq('c', 'S')] } });
    expect(T.leavesOf(t).map((l) => l.id)).toEqual(['1', 'a', 'b', 'p1', 'p2', 'c']);
  });
});

describe('fromReply (the board format -> the tree)', () => {
  const S = [
    { slot: 'A.Q1', type: 'mcq', category: 'objective', generate: 2 },
    { slot: 'A.Q2', type: 'scenario', category: 'objective', generate: 2, stimulus: { count: 1, mcqs_per_stimulus: 2 } },
    { slot: 'B.Q3', type: 'srq', category: 'subjective', generate: 1 },
  ];
  test('each slot id list lands under its category and type, every top node stamped with its slot', () => {
    const t = T.fromReply({ 'A.Q1': [{ question: 'a', tag }, { question: 'b', tag, slot: 'WRONG' }], 'B.Q3': [{ or: [{ question: 'c', tag }, { question: 'd', tag }] }], notes: ['x'] }, S);
    expect(t.unseen.objective.mcq.map((q) => [q.question, q.slot])).toEqual([['a', 'A.Q1'], ['b', 'A.Q1']]);
    expect(t.unseen.subjective.srq[0].slot).toBe('B.Q3');
    expect(T.shortfallOf(t, S)).toEqual([{ slot: 'A.Q2', have: 0, need: 2 }]);
  });
  test('a stimulus group as the format writes it becomes {stimulus:{text, items}}; written sub-parts stay parts', () => {
    const t = T.fromReply({ 'A.Q2': [{ stimulus: 'passage', items: [{ question: 'x', tag }, { question: 'y', tag }] }, { stimulus: 'table', parts: [{ question: 'z', tag }] }] }, S);
    const [g, p] = t.unseen.objective.scenario;
    expect(g).toEqual({ slot: 'A.Q2', stimulus: { text: 'passage', items: [{ question: 'x', tag }, { question: 'y', tag }] } });
    expect(p).toEqual({ slot: 'A.Q2', stimulus: { text: 'table' }, parts: [{ question: 'z', tag }] });
    expect(T.liveCounts(t).get('A.Q2')).toBe(3);
  });
  test('keys that are not slot ids, teacher-marked slots and non-lists are ignored; the input is not mutated', () => {
    const reply = { objective: { MCQ: [{ question: 'a', tag }] }, 'C.Q9': [{ question: 'q', tag }], 'A.Q1': 'not a list' };
    const before = JSON.stringify(reply);
    const t = T.fromReply(reply, [...S, { slot: 'C.Q9', type: 'practical', category: 'subjective', generate: 0, teacher_marked: true }]);
    expect(t).toEqual({ unseen: {} });
    expect(JSON.stringify(reply)).toBe(before);
    expect(T.fromReply(null, S)).toEqual({ unseen: {} });
  });
});

// bd-5jmnfj.38.30 live a1: the G1-2 top-up keys items on question/answer text, so every OR node and stimulus group
// keyed to "" and a top-up's new OR question was dropped as "already there" (B.Q1-6 stuck at 5/6).
describe('topUp (board trees: OR nodes and stimulus groups)', () => {
  const orQ = (n, slot) => ({ slot, or: [mcq(`${n}a`, slot, { question: `alt one ${n}` }), mcq(`${n}b`, slot, { question: `alt two ${n}` })] });
  const grp = (n, slot) => ({ slot, stimulus: { text: `passage ${n}`, items: [mcq(`${n}1`, slot), mcq(`${n}2`, slot)] } });
  const srq = (...items) => ({ unseen: { subjective: { srq: items } } });
  test('a new OR question and a new group for a short slot are added beside the ones already there', () => {
    const first = srq(orQ(1, 'B'), orQ(2, 'B'), grp(1, 'G'));
    const out = T.topUp(first, srq(orQ(3, 'B'), grp(2, 'G')), new Set(['B', 'G']));
    expect(out.unseen.subjective.srq.map((q) => (q.or ? q.or[0].question : q.stimulus.text))).toEqual(['alt one 1', 'alt one 2', 'passage 1', 'alt one 3', 'passage 2']);
  });
  test('a node the first tree already holds, or one for a slot not asked for, is not added', () => {
    const out = T.topUp(srq(orQ(1, 'B'), grp(1, 'G')), srq(orQ(1, 'B'), grp(1, 'G'), orQ(9, 'X')), new Set(['B', 'G']));
    expect(out.unseen.subjective.srq).toHaveLength(2);
  });
  test('places a node under its own category and type, and leaves both inputs as they were', () => {
    const first = srq(orQ(1, 'B'));
    const second = tree(mcq('n', 'M'));
    const before = JSON.stringify([first, second]);
    const out = T.topUp(first, second, new Set(['M']));
    expect(out.unseen.objective.MCQs.map((q) => q.id)).toEqual(['n']);
    expect(out.unseen.subjective.srq).toHaveLength(1);
    expect(JSON.stringify([first, second])).toBe(before);
  });
});

// round 9b: a review-only drop whose replacement fails a hard check gets its original back
describe('fill (up to a count per slot, plain nodes only)', () => {
  const grp = (n, slot) => ({ slot, stimulus: { text: `passage ${n}`, items: [mcq(`${n}1`, slot), mcq(`${n}2`, slot)] } });
  test('adds at most the wanted number per slot, skips groups, nodes already there and slots not wanted', () => {
    const first = tree(mcq('a', 'M'));
    const second = tree(mcq('a', 'M'), mcq('b', 'M'), mcq('c', 'M'), mcq('d', 'N'), grp(1, 'M'));
    const before = JSON.stringify([first, second]);
    const out = T.fill(first, second, new Map([['M', 1]]));
    expect(out.unseen.objective.MCQs.map((q) => q.id)).toEqual(['a', 'b']);
    expect(T.fill(first, second, new Map()).unseen.objective.MCQs.map((q) => q.id)).toEqual(['a']);
    expect(JSON.stringify([first, second])).toBe(before);
  });
  test('rank (lower first) picks which spare nodes fill a slot; ties keep their order', () => {
    const second = tree(mcq('b', 'M'), mcq('c', 'M'), mcq('d', 'M'));
    const out = T.fill(tree(), second, new Map([['M', 2]]), (q) => (q.id === 'b' ? 1 : 0));
    expect(out.unseen.objective.MCQs.map((q) => q.id)).toEqual(['c', 'd']);
  });
});
