'use strict';
const { unitsOf, unitMarks } = require('../../../bot/shared/services/assessment/board-6-12/units');

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
