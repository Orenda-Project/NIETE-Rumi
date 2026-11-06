'use strict';
/**
 * A made-up 20-mark board variant that no real entry has: an OR slot, an "attempt 2 of 3" slot, a teacher-marked
 * project slot and holistic-band marking. Marks are quarter-safe; every number is derived here, none is board data.
 */
const slot = (o) => ({
  label_ur: null, category: o.type === 'mcq' ? 'objective' : 'subjective', parts: null, or: null, project: null, teacher_marked: false, stimulus: null,
  instruction_en: null, ...o, marks: o.attempt * o.marks_each,
});

function fictionalVariant() {
  const A = [slot({ slot: 'A.Q1', label_en: 'Q1', type: 'mcq', printed: 4, attempt: 4, generate: 4, marks_each: 1 })];
  const B = [
    slot({ slot: 'B.Q2', label_en: 'Q2', type: 'srq', printed: 3, attempt: 2, generate: 3, marks_each: 4 }),
    slot({ slot: 'B.Q3', label_en: 'Q3', type: 'srq', printed: 1, attempt: 1, generate: 1, marks_each: 5, or: { branches: [{ type: 'srq', marks_each: 5, generate: 1 }, { type: 'srq', marks_each: 5, generate: 1 }] } }),
  ];
  const C = [slot({
    slot: 'C.Q4', label_en: 'Q4', type: 'practical', printed: 1, attempt: 1, generate: 0, marks_each: 3, teacher_marked: true,
    project: { marks: 3, instruction_en: 'Make a made-up working model and describe it.' },
  })];
  return {
    variant_id: 'fictional-2026', label_en: 'Made-up variant', total_marks: 20, generated_marks: 17, teacher_marked_marks: 3, total_time_min: null, shared_time_min: null,
    cognitive_split: { tolerance_pp: 5, levels: { K: 30, U: 50, A: 20 }, source: 'policy', status: 'verified' }, scheme_style: 'holistic_bands',
    exam_header: { lines_en: ['Made-up Board Examination', 'Physics · Examination Paper'], lines_ur: [] },
    sections: [
      { id: 'A', label_en: 'Section A', time_min: null, answer_on: 'question_paper', marks: 4, slots: A },
      { id: 'B', label_en: 'Section B', time_min: null, answer_on: 'e_sheet', marks: 13, slots: B },
      { id: 'C', label_en: 'Section C', time_min: null, answer_on: 'e_sheet', marks: 3, slots: C },
    ],
  };
}

const fictionalEntry = () => ({ key: 'physics', medium: 'en', name_en: 'Physics', legend: null, variants: [fictionalVariant()] });

module.exports = { fictionalVariant, fictionalEntry };
