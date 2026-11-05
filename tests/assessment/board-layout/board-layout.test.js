'use strict';
const path = '../../../bot/shared/services/assessment/';
const { buildLayout, LayoutTotalError } = require(`${path}board-layout`);
const C = require(`${path}patterns/board/chrome`);
const ssc1 = require(`${path}patterns/board/fbise-ssc1`);
const ssc2 = require(`${path}patterns/board/fbise-ssc2`);

const exam = (subject) => ({ subject, sections: [{ id: 'A', items: [{ q: 'Which organelle makes ATP? (fictional)' }] }] });
const pick = (pat, key, id) => pat.subjects[key].variants.find((v) => v.variant_id === id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const sum = (L) => L.sections.reduce((n, s) => n + s.marks, 0);

describe('buildLayout on real FBISE entries', () => {
  test('SSC-I biology 50% variant: shape, totals, omr, stimulus printed once', () => {
    const v = pick(ssc1, 'biology', '50pct');
    const L = buildLayout(ssc1, v, exam('biology'));
    expect(L.profile).toBe('board');
    expect(L.variant).toBe('50pct');
    expect(L.scheme_style).toBe('analytic_points');
    expect(L.header).toEqual(v.exam_header);
    expect(L.legend).toEqual(ssc1.subjects.biology.legend);
    expect(L.sections.map((s) => [s.id, s.marks, s.time_min, s.answer_on])).toEqual([
      ['A', 30, 80, 'omr'], ['B', 18, null, 'e_sheet'], ['C', 12, null, 'e_sheet']]);
    expect(sum(L)).toBe(60);
    const stim = L.slots.find((s) => s.label === 'Q41-60');
    expect(stim.stimulus).toEqual({ count: 5, mcqs_per_stimulus: 4, kinds: ['passage'] });
    expect(L.slots.filter((s) => s.stimulus).length).toBe(1);
  });

  test('SSC-I biology non-50% variant: counts and marks come from the entry', () => {
    const L = buildLayout(ssc1, pick(ssc1, 'biology', 'nonpct'), exam('biology'));
    const b = L.slots.find((s) => s.label === 'Q2 (i)-(x)');
    expect([b.printed, b.attempt, b.marks_each, b.marks]).toEqual([10, 10, 3, 30]);
    const c = L.slots.find((s) => s.label === 'Q3-5');
    expect([c.printed, c.attempt, c.marks_each]).toEqual([3, 3, 6]);
    expect(sum(L)).toBe(60);
    expect(L.sections[0].time_min).toBe(20);
  });

  test('SSC-II maths non-50% and 50% both sum to 75', () => {
    expect(sum(buildLayout(ssc2, pick(ssc2, 'maths', 'nonpct'), exam('maths')))).toBe(75);
    expect(sum(buildLayout(ssc2, pick(ssc2, 'maths', '50pct'), exam('maths')))).toBe(75);
  });

  test('Urdu-medium subject is rtl, English is not', () => {
    const u = buildLayout(ssc1, ssc1.subjects.urdu.variants[0], exam('urdu'));
    expect(u.rtl).toBe(true);
    expect(u.medium).toBe('ur');
    expect(sum(u)).toBe(75);
    const e = buildLayout(ssc1, pick(ssc1, 'biology', '50pct'), exam('biology'));
    expect(e.rtl).toBe(false);
  });

  test('islamiat keeps its Section D slot and totals 100', () => {
    const L = buildLayout(ssc1, ssc1.subjects.islamiat.variants[0], exam('islamiat'));
    expect(L.sections.map((s) => s.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(sum(L)).toBe(100);
  });

  test('accepts a bare subject entry as pattern', () => {
    const subj = ssc1.subjects.biology;
    expect(sum(buildLayout(subj, subj.variants[0], {}))).toBe(60);
  });

  test('unknown subject throws a named error', () => {
    expect(() => buildLayout(ssc1, ssc1.subjects.biology.variants[0], exam('nope'))).toThrow(/unknown subject/);
  });
});

describe('buildLayout on fictional variants', () => {
  const mk = (extra) => {
    const sub = C.makeSubject({
      key: 'biology', source_id: 'fictional', medium: 'en', name_en: 'Fiction', name_ur: 'x', status: 'ship',
      variants: [C.makeVariant({
        variant_id: 'v', total_marks: 16, total_time_min: 60, scheme_style: 'holistic_bands',
        cognitive_split: { levels: { K: 30, U: 50, A: 20 }, status: 'verified' },
        sections: [
          { id: 'A', time_min: 30, answer_on: 'question_paper', slots: [
            { slot: 'A.Q1', label_en: 'Q1', type: 'mcq', printed: 5, attempt: 5, marks_each: 1 }] },
          { id: 'B', time_min: 30, answer_on: 'e_sheet', ...extra, slots: [
            { slot: 'B.Q2', label_en: 'Q2', type: 'srq', printed: 5, attempt: 3, marks_each: 2 },
            { slot: 'B.Q3', label_en: 'Q3', or: { branches: [{ type: 'erq', marks_each: 4 }, { type: 'essay', marks_each: 4 }] } },
            { slot: 'B.Q4', label_en: 'Q4', project: { marks: 1, instruction_en: 'Teacher marks the project.' } }] },
        ],
      })],
    });
    return { subject: sub, variant: sub.variants[0] };
  };

  test('OR slot carries both branches; project slot counted but generates nothing', () => {
    const { subject, variant } = mk();
    const L = buildLayout(subject, variant, exam('biology'));
    const or = L.slots.find((s) => s.label === 'Q3');
    expect(or.or.branches.map((b) => b.type)).toEqual(['erq', 'essay']);
    expect(or.printed).toBe(2);
    const pr = L.slots.find((s) => s.label === 'Q4');
    expect(pr.teacher_marked).toBe(true);
    expect(pr.generate).toBe(0);
    expect(pr.marks).toBe(1);
    expect(sum(L)).toBe(16);
    const any = L.slots.find((s) => s.label === 'Q2');
    expect([any.printed, any.attempt, any.marks]).toEqual([5, 3, 6]);
  });

  test('timed parts pass through on the section', () => {
    const parts = [{ part: 'I', marks: 5, time_min: 10, handover_note_en: 'hand over' }];
    const { subject, variant } = mk();
    variant.sections[1].parts = parts; // chrome.makeSection does not carry parts yet
    const L = buildLayout(subject, variant, exam('biology'));
    expect(L.sections[1].parts).toEqual(parts);
    expect(L.sections[0].parts).toBeNull();
  });

  test('a wrong variant total throws LayoutTotalError naming the paper', () => {
    const { subject, variant } = mk();
    const bad = clone(variant);
    bad.total_marks = 17;
    expect(() => buildLayout(subject, bad, exam('biology'))).toThrow(LayoutTotalError);
    expect(() => buildLayout(subject, bad, exam('biology'))).toThrow(/paper.*17/);
  });

  test('a wrong section total throws LayoutTotalError naming the section', () => {
    const { subject, variant } = mk();
    const bad = clone(variant);
    bad.sections[0].marks = 6;
    let err;
    try { buildLayout(subject, bad, exam('biology')); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(LayoutTotalError);
    expect(err.name).toBe('LayoutTotalError');
    expect(err.message).toMatch(/section A/);
  });

  test('the layout is a copy: mutating it leaves the pattern alone', () => {
    const { subject, variant } = mk();
    const L = buildLayout(subject, variant, exam('biology'));
    L.slots[0].marks = 99;
    L.sections[0].marks = 99;
    expect(variant.sections[0].marks).toBe(5);
  });

  test('half marks are summed exactly', () => {
    const { subject, variant } = mk();
    const odd = clone(variant);
    odd.sections[1].slots[0].marks_each = 0.5;
    odd.sections[1].slots[0].attempt = 1;
    odd.sections[1].slots[0].printed = 1;
    odd.sections[1].marks = 0.5 + 4 + 1;
    odd.total_marks = 5 + 0.5 + 4 + 1;
    expect(sum(buildLayout(subject, odd, exam('biology')))).toBe(10.5);
  });
});
