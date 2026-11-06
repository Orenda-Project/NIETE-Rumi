'use strict';
const { slotLine } = require('../../../bot/shared/services/assessment/board-6-12/slot-lines');

const base = { slot: 'A.Q1', label_en: 'Q1', type: 'mcq', printed: 20, attempt: 20, generate: 20, marks_each: 1 };

describe('slotLine', () => {
  test('a plain slot names its id, count, type and marks', () => {
    expect(slotLine(base)).toBe('- Q1 [slot A.Q1]: 20 x mcq at 1 marks');
  });
  test('attempt N of M says to write all M', () => {
    expect(slotLine({ ...base, slot: 'B.Q3', label_en: 'Q3', type: 'srq', printed: 14, attempt: 10, generate: 14, marks_each: 5 }))
      .toBe('- Q3 [slot B.Q3]: 14 x srq at 5 marks; attempt any 10 of 14, write all 14');
  });
  test('attempt equal to printed adds no attempt text', () => {
    expect(slotLine({ ...base, attempt: 20 })).not.toMatch(/attempt/);
  });
  test('an OR slot asks for both alternatives', () => {
    const s = { ...base, type: 'srq', printed: 1, attempt: 1, generate: 1, marks_each: 5, or: { branches: [{ type: 'srq', marks_each: 5 }, { type: 'erq', marks_each: 5 }] } };
    expect(slotLine(s)).toBe('- Q1 [slot A.Q1]: 1 x srq at 5 marks; OR: write both alternatives (srq / erq) at 5 marks each');
  });
  test('an FBISE internal-OR slot asks each item to carry both alternatives', () => {
    expect(slotLine({ ...base, type: 'srq', printed: 6, attempt: 6, generate: 6, marks_each: 3, prompt_rule: 'internal_or' }))
      .toBe('- Q1 [slot A.Q1]: 6 x srq at 3 marks; each item offers an internal OR: write both alternatives at 3 marks each');
  });
  test('a stimulus slot names the texts and items per text', () => {
    const s = { ...base, type: 'scenario', stimulus: { count: 5, mcqs_per_stimulus: 4, kinds: ['passage', 'table'] } };
    expect(slotLine(s)).toBe('- Q1 [slot A.Q1]: 20 x scenario at 1 marks; stimulus: 5 texts (passage / table), 4 items each, text only');
  });
  test('a teacher-marked slot writes no items', () => {
    const s = { ...base, type: 'practical', generate: 0, teacher_marked: true, marks_each: 5, project: { marks: 5, instruction_en: 'Make a model.' } };
    expect(slotLine(s)).toBe('- Q1 [slot A.Q1]: TEACHER-MARKED, 5 marks; Make a model.; write no items');
  });
  test('a project slot without a teacher_marked flag is still teacher-marked', () => {
    const s = { ...base, generate: 0, project: { marks: 3, instruction_en: 'Observe.' } };
    expect(slotLine(s)).toMatch(/^- Q1 \[slot A.Q1\]: TEACHER-MARKED, 3 marks; Observe\./);
  });
});
