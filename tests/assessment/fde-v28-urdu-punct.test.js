/**
 * v27 G5 Urdu Q1 item 15 (bd-5jmnfj.4.58.3): the punctuation MCQ printed «الف) ۔ “ ” (واوین)» and
 * «ب) (ختمہ)» — the full stop had slid from the ختمہ option into the واوین one. A رموزِ اوقاف item is
 * normalised in code: each option that names a mark in words prints exactly that mark before the name,
 * the label stays, and the key follows its option.
 *
 * Pure: {examJson, notes}; an MCQ that is not about punctuation is untouched.
 */

const { urduPunctFixes } = require('../../bot/shared/services/assessment/fde-urdu-punct');

const paper = (items) => ({ unseen: { objective: { MCQs: items } }, _layout: { sections: [{ id: 'A', slots: [{ slot: 'urdu.A.Q1', type: 'MCQs' }] }] } });
const mcqs = (ex) => ex.unseen.objective.MCQs;

const v27 = () => ({
  slot: 'urdu.A.Q1', question: 'اس جملے کے آخر میں کون سی علامت آئے گی: «کیا تم اسکول جاؤ گے»',
  options: ['الف) ۔ “ ” (واوین)', 'ب) (ختمہ)', 'ج) ؟ (سوالیہ نشان)', 'د) ، (سکتہ)'], answer: 'ج) ؟ (سوالیہ نشان)',
});

test('every named mark prints its own sign once, with the label kept', () => {
  const { examJson, notes } = urduPunctFixes(paper([v27()]));
  expect(mcqs(examJson)[0].options).toEqual(['الف) “ ” (واوین)', 'ب) ۔ (ختمہ)', 'ج) ؟ (سوالیہ نشان)', 'د) ، (سکتہ)']);
  expect(mcqs(examJson)[0].answer).toBe('ج) ؟ (سوالیہ نشان)');
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatch(/urdu\.A\.Q1/);
});

test('the key follows its option when that option is the one fixed', () => {
  const q = { ...v27(), answer: 'ب) (ختمہ)' };
  const { examJson } = urduPunctFixes(paper([q]));
  expect(mcqs(examJson)[0].answer).toBe('ب) ۔ (ختمہ)');
});

test('an MCQ that is not about punctuation, and one already right, are returned as they were', () => {
  const plain = { slot: 'urdu.A.Q1', question: '«خوشی» کا متضاد کیا ہے؟', options: ['الف) غم', 'ب) ہنسی', 'ج) مزہ', 'د) ۔ کھیل'], answer: 'الف) غم' };
  const right = { ...v27(), options: ['الف) “ ” (واوین)', 'ب) ۔ (ختمہ)', 'ج) ؟ (سوالیہ نشان)', 'د) ، (سکتہ)'] };
  const { examJson, notes } = urduPunctFixes(paper([plain, right]));
  expect(mcqs(examJson)).toEqual([plain, right]);
  expect(notes).toEqual([]);
  expect(urduPunctFixes(null).notes).toEqual([]);
});
