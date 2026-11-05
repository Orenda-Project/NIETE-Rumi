/**
 * board/chrome.js: the builders every G6-12 board pattern is made with (SPEC §4). They compute what a slot
 * generates and is worth, refuse arithmetic that disagrees with a declared total (BLUEPRINTS B5), and freeze
 * the result. Board-specific header lines come from fde-chrome.js (and fbise-chrome.js, b-patterns-fbise).
 */
const C = require('../../../bot/shared/services/assessment/patterns/board/chrome');

const mcq = (o = {}) => ({ slot: 'A.Q1', label_en: 'Q.1', type: 'mcq', printed: 20, marks_each: 1, ...o });

describe('makeSlot', () => {
  test('a plain slot generates what it prints and is worth attempt × marks', () => {
    const s = C.makeSlot({ slot: 'B.Q2', label_en: 'Q.2', type: 'srq', printed: 14, attempt: 10, marks_each: 4 });
    expect(s).toMatchObject({
      slot: 'B.Q2', type: 'srq', category: 'subjective', printed: 14, attempt: 10, generate: 14,
      marks_each: 4, marks: 40, marks_x4: 16, total_x4: 160, teacher_marked: false, or: null, project: null,
    });
    expect(s.label_ur).toBe('سوال 2');
    expect(s.instruction_en).toBe('Attempt any {n:10} questions.');
    expect(s.marks_line_en).toBe('({n:10} × 4 = {t:40})');
  });

  test('attempt defaults to printed; one item prints its marks alone', () => {
    const s = C.makeSlot({ slot: 'C.Q9', label_en: 'Q.9', type: 'comprehension', marks_each: 12 });
    expect(s).toMatchObject({ printed: 1, attempt: 1, generate: 1, marks: 12, instruction_en: null });
    expect(s.marks_line_en).toBe('({t:12})');
    const m = C.makeSlot(mcq());
    expect(m).toMatchObject({ attempt: 20, category: 'objective', marks: 20 });
    expect(m.instruction_en).toBe('Encircle the correct option.');
    expect(m.marks_line_en).toBe('({n:20} × 1 = {t:20})');
  });

  test('quarter and half marks are exact in ×4 integers (P2)', () => {
    const s = C.makeSlot({ slot: 'C.Q3.3', label_en: 'Q.3.3', type: 'erq', marks_each: 7.5 });
    expect(s).toMatchObject({ marks_x4: 30, total_x4: 30, marks: 7.5 });
    expect(() => C.makeSlot({ slot: 'x', label_en: 'x', type: 'erq', marks_each: 0.3 })).toThrow(/quarter/);
  });

  test('an OR slot prints both branches, keys both, and counts one (P5)', () => {
    const s = C.makeSlot({
      slot: 'C.Q7', label_en: 'Q.7', or: { branches: [{ type: 'letter', marks_each: 8 }, { type: 'letter', marks_each: 8 }] },
    });
    expect(s).toMatchObject({ type: 'letter', printed: 2, attempt: 1, generate: 2, marks_each: 8, marks: 8, category: 'subjective' });
    expect(s.or.branches).toHaveLength(2);
    expect(s.or.branches[1]).toEqual({ type: 'letter', marks_each: 8, generate: 1 });
  });

  test('an OR slot refuses unequal branches or a single branch', () => {
    const br = (m) => ({ type: 'essay', marks_each: m });
    expect(() => C.makeSlot({ slot: 'x', label_en: 'x', or: { branches: [br(8), br(7)] } })).toThrow(/equal/);
    expect(() => C.makeSlot({ slot: 'x', label_en: 'x', or: { branches: [br(8)] } })).toThrow(/two/);
    expect(() => C.makeSlot({ slot: 'x', label_en: 'x', or: { branches: [br(8), { type: 'nope', marks_each: 8 }] } })).toThrow(/type/);
  });

  test('a teacher-marked slot counts its marks and generates nothing (R14, P6)', () => {
    const s = C.makeSlot({
      slot: 'D.Q5', label_en: 'Part-5', project: { marks: 10, instruction_en: 'Project: present a character with flash cards.' },
    });
    expect(s).toMatchObject({
      type: 'practical', category: 'out_of_exam', teacher_marked: true, generate: 0, attempt: 1, printed: 1, marks_each: 10, marks: 10,
    });
    expect(s.project).toEqual({ marks: 10, instruction_en: 'Project: present a character with flash cards.', instruction_ur: null, teacher_marked: true });
    expect(() => C.makeSlot({ slot: 'x', label_en: 'x', project: { marks: 10 } })).toThrow(/instruction/);
  });

  test('parts must add up to the slot marks', () => {
    const s = C.makeSlot({ slot: 'R.Q1', label_en: 'Q.1', type: 'comprehension', marks_each: 20, parts: [5, 5, 5, 1, 2, 2] });
    expect(s.parts).toEqual([5, 5, 5, 1, 2, 2]);
    expect(() => C.makeSlot({ slot: 'x', label_en: 'x', type: 'comprehension', marks_each: 20, parts: [5, 5] })).toThrow(/parts/);
  });

  test('refuses an unknown type, a bad count or a missing label', () => {
    expect(() => C.makeSlot(mcq({ type: 'picture' }))).toThrow(/type/);
    expect(() => C.makeSlot(mcq({ attempt: 21 }))).toThrow(/attempt/);
    expect(() => C.makeSlot(mcq({ attempt: 0 }))).toThrow(/attempt/);
    expect(() => C.makeSlot(mcq({ printed: 2.5 }))).toThrow(/printed/);
    expect(() => C.makeSlot(mcq({ marks_each: 0 }))).toThrow(/marks/);
    expect(() => C.makeSlot(mcq({ label_en: '' }))).toThrow(/label/);
    expect(() => C.makeSlot(mcq({ slot: '' }))).toThrow(/slot/);
  });

  test('keeps the optional fields the writer reads', () => {
    const s = C.makeSlot(mcq({
      slo_code_prefix: 'M-08-', level_policy: 'per_item', prompt_rule: 'rule', deviation: 'dev', instruction_en: 'Circle it.',
      instruction_ur: 'دائرہ لگائیں', label_ur: 'سوال 1', stimulus: { count: 2, mcqs_per_stimulus: 4, kinds: ['passage'] },
    }));
    expect(s).toMatchObject({
      slo_code_prefix: 'M-08-', level_policy: 'per_item', prompt_rule: 'rule', deviation: 'dev', instruction_en: 'Circle it.',
      instruction_ur: 'دائرہ لگائیں', label_ur: 'سوال 1', stimulus: { count: 2, mcqs_per_stimulus: 4, kinds: ['passage'] },
    });
    expect(C.makeSlot(mcq())).toMatchObject({ slo_code_prefix: null, level_policy: null, stimulus: null, deviation: null });
  });

  test('a stimulus may never ask for a figure (P3)', () => {
    expect(() => C.makeSlot(mcq({ stimulus: { count: 1, mcqs_per_stimulus: 4, kinds: ['graph'] } }))).toThrow(/stimulus/);
  });
});

describe('makeSection', () => {
  test('sums its slots and checks a declared total (B5)', () => {
    const sec = C.makeSection({ id: 'A', label_en: 'SECTION-A', marks: 20, time_min: 30, answer_on: 'question_paper', slots: [mcq()] });
    expect(sec).toMatchObject({ id: 'A', marks: 20, marks_x4: 80, time_min: 30, answer_on: 'question_paper', label_ur: null, note_en: null });
    expect(sec.marks_en).toBe('Total Marks: {t:20}');
    expect(() => C.makeSection({ id: 'A', label_en: 'A', marks: 21, slots: [mcq()] })).toThrow(/21/);
  });

  test('defaults: answer on the answer sheet, no printed time', () => {
    const sec = C.makeSection({ id: 'B', label_en: 'B', slots: [mcq()] });
    expect(sec).toMatchObject({ answer_on: 'e_sheet', time_min: null });
  });

  test('refuses an unknown answer_on, an empty section or duplicate slots', () => {
    expect(() => C.makeSection({ id: 'A', label_en: 'A', answer_on: 'board', slots: [mcq()] })).toThrow(/answer_on/);
    expect(() => C.makeSection({ id: 'A', label_en: 'A', slots: [] })).toThrow(/slots/);
    expect(() => C.makeSection({ id: 'A', label_en: 'A', slots: [mcq(), mcq()] })).toThrow(/duplicate/);
  });
});

describe('makeVariant', () => {
  const sections = () => [
    { id: 'A', label_en: 'A', marks: 20, slots: [mcq()] },
    { id: 'B', label_en: 'B', marks: 10, slots: [{ slot: 'B.Q2', label_en: 'Q.2', project: { marks: 10, instruction_en: 'Do it.' } }] },
  ];
  const split = { levels: { R: 30, U: 30, A: 20, AE: 10, C: 10 }, source: 'ToS', status: 'verified' };

  test('totals marks, generated marks and the MCQ share', () => {
    const v = C.makeVariant({ total_marks: 30, total_time_min: 90, cognitive_split: split, scheme_style: 'analytic_points', sections: sections() });
    expect(v).toMatchObject({
      variant_id: 'default', applies_to: { sessions: ['*'] }, total_marks: 30, generated_marks: 20, teacher_marked_marks: 10,
      total_time_min: 90, shared_time_min: null, scheme_style: 'analytic_points', label_en: null, exam_header: null,
    });
    expect(v.cognitive_split).toEqual({ ...split, tolerance_pp: 5 });
    expect(v.mcq_share_x100).toBe(6667);
  });

  test('refuses a total that disagrees, a split that does not sum to 100, or an unknown style', () => {
    const base = { total_marks: 30, cognitive_split: split, scheme_style: 'holistic_bands', sections: sections() };
    expect(() => C.makeVariant({ ...base, total_marks: 31 })).toThrow(/31/);
    expect(() => C.makeVariant({ ...base, cognitive_split: { ...split, levels: { R: 30, U: 30 } } })).toThrow(/100/);
    expect(() => C.makeVariant({ ...base, cognitive_split: { ...split, levels: { R: 50, X: 50 } } })).toThrow(/level/);
    expect(() => C.makeVariant({ ...base, cognitive_split: { ...split, status: 'guess' } })).toThrow(/status/);
    expect(() => C.makeVariant({ ...base, scheme_style: 'bands' })).toThrow(/scheme_style/);
    expect(() => C.makeVariant({ ...base, sections: [] })).toThrow(/sections/);
  });

  test('B and C sharing one time carry null section times (P10)', () => {
    const secs = sections();
    secs[1].time_min = 60;
    expect(() => C.makeVariant({ total_marks: 30, shared_time_min: 160, shared_sections: ['B'], cognitive_split: split, scheme_style: 'holistic_bands', sections: secs })).toThrow(/shared/);
    const ok = C.makeVariant({ total_marks: 30, shared_time_min: 160, shared_sections: ['B'], cognitive_split: split, scheme_style: 'holistic_bands', sections: sections() });
    expect(ok).toMatchObject({ shared_time_min: 160, shared_sections: ['B'] });
  });

  test('K/U/A splits are allowed', () => {
    const v = C.makeVariant({ total_marks: 30, cognitive_split: { levels: { K: 30, U: 50, A: 20 }, source: 'R15', status: 'design_pending' }, scheme_style: 'holistic_bands', sections: sections() });
    expect(v.cognitive_split.status).toBe('design_pending');
  });
});

describe('time words', () => {
  test.each([[180, '3 hrs'], [120, '2 hrs'], [90, '1 hr 30 min'], [60, '1 hr'], [20, '20 min'], [null, null]])('%p → %p', (m, want) => {
    expect(C.timeEn(m)).toBe(want);
  });
  test.each([[180, '3 گھنٹے'], [60, '1 گھنٹہ'], [90, '1 گھنٹہ 30 منٹ'], [45, '45 منٹ'], [null, null]])('ur %p → %p', (m, want) => {
    expect(C.timeUr(m)).toBe(want);
  });
});

describe('GRADE_WORD', () => {
  test('VI to XII, en and ur', () => {
    expect(Object.keys(C.GRADE_WORD).map(Number)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(C.GRADE_WORD[8]).toEqual({ en: 'Class VIII', roman: 'VIII', ur: 'جماعت ہشتم' });
  });
});
