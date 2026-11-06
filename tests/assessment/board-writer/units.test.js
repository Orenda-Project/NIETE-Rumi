'use strict';
const { unitsOf, unitMarks, chunksOf, sized } = require('../../../bot/shared/services/assessment/board-6-12/units');

const slot = (id, marks, extra) => ({ slot: id, marks_each: marks, attempt: 1, ...extra });

describe('unitsOf', () => {
  test('one unit per section when there are no parts', () => {
    const V = { sections: [{ id: 'A', label_en: 'Section A', time_min: 30, slots: [slot('A.1', 1)] }, { id: 'B', time_min: null, slots: [slot('B.1', 2)] }] };
    const u = unitsOf(V);
    expect(u.map((x) => x.key)).toEqual(['A', 'B']);
    expect(u[0].time_min).toBe(30);
    expect(u[0].title).toBe('Section A');
    expect(u[1].title).toBe('B');
    expect(u[1].slots).toHaveLength(1);
  });
  test('a section with parts is one unit per part, keyed B(i)', () => {
    const V = { sections: [{ id: 'B', label_en: 'Sec B', time_min: 60, slots: [slot('B.1', 2), slot('B.2', 3)], parts: [{ id: 'i', slots: ['B.1'], time_min: 20 }, { id: 'ii', slots: ['B.2'] }] }] };
    const u = unitsOf(V);
    expect(u.map((x) => x.key)).toEqual(['B(i)', 'B(ii)']);
    expect(u[0].slots.map((s) => s.slot)).toEqual(['B.1']);
    expect(u[0].time_min).toBe(20);
    expect(u[1].time_min).toBeNull();
    expect(u[1].section.id).toBe('B');
  });
  test('parts that are not slot lists are ignored (design_pending shape)', () => {
    const V = { sections: [{ id: 'B', time_min: null, slots: [slot('B.1', 2)], parts: [1, 2] }] };
    expect(unitsOf(V).map((x) => x.key)).toEqual(['B']);
  });
  test('a unit that generates nothing is flagged', () => {
    const V = { sections: [{ id: 'D', slots: [slot('D.1', 5, { generate: 0, teacher_marked: true })] }, { id: 'E', slots: [slot('E.1', 5, { generate: 2 })] }] };
    const u = unitsOf(V);
    expect(u[0].generates).toBe(false);
    expect(u[1].generates).toBe(true);
  });
});

describe('unitMarks', () => {
  test('sums attempt x marks_each, project slots at their own marks', () => {
    expect(unitMarks([slot('a', 0.5, { attempt: 3 }), slot('b', 2.25, { attempt: 2 }), slot('c', 9, { project: { marks: 4 } })])).toBe(0.5 * 3 + 4.5 + 4);
  });
});

describe('chunksOf (round 4: no call asks more than 20 items)', () => {
  const big = (id, n, extra) => slot(id, 1, { type: 'mcq', printed: n, attempt: n, generate: n, ...extra });
  const unit = (slots) => ({ key: 'A', title: 'A', slots, time_min: null, generates: true });
  test('a unit with no slot over 20 is one call, unchanged', () => {
    const u = unit([big('A.1', 20), big('A.2', 5)]);
    expect(chunksOf(u)).toEqual([u]);
  });
  test('56 MCQs are 20/20/16, each a copy of the slot with its own count and range', () => {
    const c = chunksOf(unit([big('A.Q1', 56)]));
    expect(c.map((x) => x.slots[0].generate)).toEqual([20, 20, 16]);
    expect(c.map((x) => [x.chunk.from, x.chunk.to, x.chunk.total])).toEqual([[1, 20, 56], [21, 40, 56], [41, 56, 56]]);
    expect(c[2].slots[0]).toMatchObject({ slot: 'A.Q1', printed: 16, attempt: 16 });
  });
  test('a 6x4 stimulus slot is 5 groups (20) then 1 group (4); small slots share one call after', () => {
    const stim = big('A.S', 24, { type: 'scenario', stimulus: { count: 6, mcqs_per_stimulus: 4 } });
    const c = chunksOf(unit([stim, big('A.2', 3)]));
    expect(c.map((x) => x.slots.map((s) => `${s.slot}:${s.generate}`))).toEqual([['A.S:20'], ['A.S:4'], ['A.2:3']]);
    expect(c[0].slots[0].stimulus.count).toBe(5);
    expect(c[1].slots[0].stimulus.count).toBe(1);
  });
  test('an attempt-any slot is never split', () => {
    const u = unit([big('B.1', 24, { attempt: 20 })]);
    expect(chunksOf(u)).toEqual([u]);
  });
  test('sized: a stimulus slot asked for 7 items rounds up to whole groups', () => {
    const s = sized(big('A.S', 24, { stimulus: { count: 6, mcqs_per_stimulus: 4 } }), 7);
    expect([s.generate, s.stimulus.count]).toEqual([8, 2]);
  });
});
