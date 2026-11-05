'use strict';
// Hand-built fictional layouts and items for the exact-output tests (every field explicit).
const pSlots = [
  { slot: 'A.1', section: 'A', type: 'mcq', label: 'Q1 MCQs', label_ur: 'سوال ۱', marks: 1, marks_each: 0.5, attempt: 2, printed: 2 },
  { slot: 'A.2', section: 'A', type: 'scenario', label: 'Q2', marks: 2, marks_each: 2, attempt: 1, printed: 1 },
  { slot: 'A.3', section: 'A', type: 'srq', label: 'Q3', marks: 6, marks_each: 2, attempt: 3, printed: 5 },
  { slot: 'A.4', section: 'A', type: 'erq', label: 'Q4', marks: 5, marks_each: 5, attempt: 1, printed: 1, or: { branches: [1, 2, 3] } },
  { slot: 'A.5', section: 'A', label: 'Q5', marks: 3.5, marks_each: 3.5, attempt: 1, printed: 1, teacher_marked: true, project: { marks: 3.5, instruction_en: 'Make it.' } },
  { slot: 'A.6', section: 'A', type: 'srq', label: 'Q6', marks: 4, marks_each: 2, attempt: 2, printed: 2 },
];
const pLayout = { slots: pSlots, sections: [] };
const stim = { id: 'S1', text: 'Stim <1>' };
const pItems = {
  'A.1': [{ question: 'q1 a', options: ['x', 'y'], stimulus: stim }, { question: 'q1 b', options: ['p', 'q', 'r', 's'], stimulus: stim }],
  'A.2': [{ question: 'sc', stimulus: { id: 'S2', text: 'T2' } }],
  'A.3': [{ question: 's1' }, { question: 's2' }, { question: 's3' }],
  'A.4': [{ question: 'e1' }, { question: 'e2' }, { question: 'e3' }],
  'A.6': [{ question: 'z' }],
};
const pBy = new Map(Object.entries(pItems));
const pSecs = {
  qp: { id: 'A', marks: 21.5, time_min: 30, answer_on: 'question_paper', parts: [{ part: 'P1', marks: 3, time_min: 15, handover_note_en: 'Hand P1', handover_note_ur: 'ہینڈ' }, { part: 'P2', marks: 3.5, handover_note_en: 'Hand P2' }] },
  omr: { id: 'A', marks: 21.5, answer_on: 'omr' },
};

const sSlots = [
  { slot: 'A.1', section: 'A', type: 'mcq', label: 'Q1', label_ur: 'سوال ۱', marks: 1, marks_each: 0.5, attempt: 2, printed: 2 },
  { slot: 'A.2', section: 'A', type: 'scenario', label: 'Q2', marks: 2, marks_each: 2, attempt: 1, printed: 1 },
  { slot: 'A.3', section: 'A', type: 'srq', label: 'Q3', marks: 4, marks_each: 2, attempt: 2, printed: 3 },
  { slot: 'A.4', section: 'A', type: 'erq', label: 'Q4', marks: 5, marks_each: 5, attempt: 1, printed: 1 },
  { slot: 'A.5', section: 'A', label: 'Q5', marks: 3.5, marks_each: 3.5, attempt: 1, printed: 1, teacher_marked: true, project: { marks: 3.5, instruction_en: 'Make it.', criteria_en: ['Neat', 'On <topic>'], instruction_ur: 'بنائیں', criteria_ur: ['صاف'] } },
  { slot: 'A.6', section: 'A', label: 'Q6', marks: 2, marks_each: 2, attempt: 1, printed: 1, teacher_marked: true, project: { marks: 2, instruction_en: 'Only en.' } },
];
const sLayout = { slots: sSlots, sections: [{ id: 'A', marks: 17.5 }, { id: 'B', marks: 2.25 }] };
const sItems = {
  'A.1': [{ question: 'q1', key: 'b', options: ['x', 'y'], tag: { blooms: 'U', official_slo: 'S-1' } }, { question: 'q2', key: 'Z', options: ['p'], tag: { blooms: 'K' } }],
  'A.2': [{ question: 'sc', key: 'A', tag: { official_slo: 'S-2' } }],
  'A.3': [{ question: 's1', answer: 'ans <1>', scheme: { points: [{ text: 'pt', marks: 0.5 }, { text: 'pt2', marks: 1.5 }] }, tag: {} }, { question: 's2', scheme: {} }],
  'A.4': [{ question: 'e1', answer: 'long', scheme: { bands: [{ marks: '4-5', descriptor: 'Good' }, { marks: '0.5', descriptor: 'None' }] } }],
};
const sBy = new Map(Object.entries(sItems));

module.exports = { pLayout, pBy, pSecs, sLayout, sBy };
