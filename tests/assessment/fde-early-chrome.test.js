/**
 * The Grade 1-2 pattern builders (bd-5jmnfj.4.2): slot defaults, the shared header
 * and the oral rubric check that refuses a rubric which does not add up.
 */

const C = require('../../bot/shared/services/assessment/patterns/early/chrome');

const task = (marks, rubric) => ({ id: 't', marks, rubric: rubric.map((m) => ({ marks: m, en: 'x', ur: 'x' })), ask: 'x' });
const subject = (oral) => C.makeSubject({
  grade: 1, key: 'maths', medium: 'en', name_en: 'Mathematics', name_ur: 'ریاضی', tos: {}, pages: 10,
  sections: [{ id: 'A', label_en: 'A', levels: { Remember: 2 },
    slots: [{ slot: 'x.A.Q1', label_en: 'Q1.', type: 'T', generate: 2, marks_each: 1, prompt_rule: 'r' }] }],
  oral,
});

test('a slot gets the Urdu label, its marks line and the early defaults', () => {
  const s = C.makeSlot({ slot: 'x', label_en: 'Q12.', type: 'T', generate: 4, marks_each: 2, prompt_rule: 'r' });
  expect(s.label_ur).toBe('سوال 12');
  expect(s.marks_line_en).toBe('({t:8})');
  expect(s.category).toBe('subjective');
  expect(s.shape).toBe('short');
  expect(s.picture).toBeNull();
  expect(s).not.toHaveProperty('option_labels');
  const m = C.makeSlot({ slot: 'y', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 5, marks_each: 1, prompt_rule: 'r' });
  expect(m.category).toBe('objective');
  expect(m.option_labels).toBe('a');
});

test('the header keeps Grade 5 chrome but none of its subject lines', () => {
  const h = C.commonHeader(2);
  expect(h.disclaimer_en).toContain('Grade II');
  expect(Object.keys(h).some((k) => /^(title|time_line|total_line|note)_(en|ur)$/.test(k))).toBe(false);
  expect(h.note_replaced_en).toEqual(expect.any(String)); // shared scheme chrome carries over
});

test('a subject with no oral part says nothing about oral marks', () => {
  const S = subject(null);
  expect(S.total_marks).toBe(2);
  expect(S.oral).toBeNull();
  expect(S.summary_lines.en.choice).toBe('');
});

test('the oral rubric is read as per-item, criteria or bands', () => {
  const S = subject({ tasks: [
    { ...task(10, [2]), id: 'each' },
    { ...task(5, [2, 2, 1]), id: 'crit' },
    { ...task(5, [5, 3, 1, 0]), id: 'band' },
  ] });
  expect(S.oral.tasks.map((t) => t.scoring)).toEqual(['each', 'criteria', 'bands']);
  expect(S.oral.marks).toBe(20);
  expect(S.header.note_en).toContain('Written 2 + oral 20 = 22 marks');
});

test('a rubric that does not add up is refused at load, not printed wrong', () => {
  expect(() => subject({ tasks: [task(10, [4, 3])] })).toThrow('rubric does not add up to 10');
  expect(() => subject({ tasks: [task(10, [3])] })).toThrow('rubric does not add up');
  expect(() => subject({ tasks: [task(5, [5, 3, 1])] })).toThrow('rubric does not add up');
});

test('build freezes the pattern and keys subjects by key', () => {
  const P = C.build({ id: 'p', grade: 1, subjects: [subject(null)] });
  expect(P.profile).toBe('early');
  expect(Object.isFrozen(P.subjects.maths.sections[0].slots[0])).toBe(true);
});
