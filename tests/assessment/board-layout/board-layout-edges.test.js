'use strict';
// Edge cases for buildLayout on raw (non-chrome) fictional entries: guards, nulls, copies, error numbers.
const { buildLayout, LayoutTotalError } = require('../../../bot/shared/services/assessment/board-layout');

const raw = () => ({
  subject: { key: 'fiction', medium: 'en', legend: { K: 'Knowledge' } },
  variant: {
    variant_id: 'v', total_marks: 7, scheme_style: 'analytic_points', exam_header: { title_en: 'Fictional Board' },
    sections: [
      { id: 'A', marks: 3, answer_on: 'omr', slots: [
        { slot: 'A.Q1', label_en: 'Q1', label_ur: 'سوال ۱', type: 'mcq', printed: 3, attempt: 3, generate: 3, marks_each: 1 }] },
      { id: 'B', marks: 4, time_min: 40, answer_on: 'e_sheet', slots: [
        { slot: 'B.Q2', label_en: 'Q2', type: 'srq', printed: 2, attempt: 1, generate: 2, marks_each: 2,
          teacher_marked: true, parts: [{ part: 'a' }] },
        { slot: 'B.Q3', label_en: 'Q3', type: 'srq', printed: 1, attempt: 1, generate: 1, marks_each: 2,
          or: { branches: [{ type: 'srq' }, { type: 'srq' }] } }] },
      { id: 'C', answer_on: 'e_sheet' },
    ],
  },
});

const build = (mut) => {
  const { subject, variant } = raw();
  if (mut) mut(variant, subject);
  return buildLayout(subject, variant, { subject: 'fiction' });
};
const errOf = (fn) => { try { fn(); } catch (e) { return e; } return null; };

describe('buildLayout guards', () => {
  test('a missing pattern throws a named message', () => {
    expect(() => buildLayout(null, raw().variant, {})).toThrow('board-layout: pattern is required');
  });
  test('a missing variant, or one without sections, throws', () => {
    const { subject } = raw();
    expect(() => buildLayout(subject, null, {})).toThrow('board-layout: variant with sections is required');
    expect(() => buildLayout(subject, { sections: 'x' }, {})).toThrow('board-layout: variant with sections is required');
  });
});

describe('buildLayout slot fields', () => {
  const get = () => { const L = build((v) => { v.sections[2].marks = 0; }); return { L, q1: L.slots[0], q2: L.slots[1], q3: L.slots[2] }; };

  test('label_ur is copied when given and null when absent', () => {
    const { q1, q2 } = get();
    expect(q1.label_ur).toBe('سوال ۱');
    expect(q2.label_ur).toBeNull();
  });
  test('teacher_marked holds without a project; project is null when absent', () => {
    const { q1, q2 } = get();
    expect(q2.teacher_marked).toBe(true);
    expect(q2.project).toBeNull();
    expect(q1.teacher_marked).toBe(false);
    expect(q1.generate).toBe(3);
  });
  test('parts, or and stimulus are copied when given and null when absent', () => {
    const { q1, q2, q3 } = get();
    expect(q2.parts).toEqual([{ part: 'a' }]);
    expect(q1.parts).toBeNull();
    expect(q3.or.branches).toHaveLength(2);
    expect(q1.or).toBeNull();
    expect(q1.stimulus).toBeNull();
  });
  test('a section with no slots has none; time_min missing becomes null', () => {
    const { L } = get();
    expect(L.sections[2]).toEqual({ id: 'C', marks: 0, time_min: null, answer_on: 'e_sheet', parts: null });
    expect(L.sections[1].time_min).toBe(40);
    expect(L.slots.filter((s) => s.section === 'C')).toHaveLength(0);
  });
  test('a section with no declared marks takes the sum of its slots', () => {
    const M = build((v) => { delete v.sections[0].marks; });
    expect(M.sections[0].marks).toBe(3);
  });
  test('header, legend and nested slot data are deep copies', () => {
    const { subject, variant } = raw();
    variant.sections[2].marks = 0;
    const N = buildLayout(subject, variant, {});
    N.header.title_en = 'changed';
    N.legend.K = 'changed';
    N.slots[1].parts[0].part = 'z';
    N.slots[2].or.branches.pop();
    expect(variant.exam_header.title_en).toBe('Fictional Board');
    expect(subject.legend.K).toBe('Knowledge');
    expect(variant.sections[1].slots[0].parts[0].part).toBe('a');
    expect(variant.sections[1].slots[1].or.branches).toHaveLength(2);
  });
});

describe('buildLayout total errors carry the real numbers', () => {
  test('section error says what the slots add up to', () => {
    const e = errOf(() => build((v) => { v.sections[0].marks = 5; }));
    expect(e).toBeInstanceOf(LayoutTotalError);
    expect(e.message).toBe('board-layout: section A slots add up to 3, not the declared 5');
  });
  test('paper error says what the sections add up to', () => {
    const e = errOf(() => build((v) => { v.total_marks = 9; }));
    expect(e.message).toBe("board-layout: paper sections add up to 7, not the variant's total_marks 9");
  });
});
