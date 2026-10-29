/**
 * bd-5jmnfj.33.2 — Sections B and C of a Grade 3-4 paper are told what Section A asked.
 * v30 G3 General Knowledge Q4 v/vi re-asked Q5 i/ii; G3 Maths Q5 parts re-asked Q1 facts: the
 * sections were written beside each other and no note carried A's items (takenNote covers
 * Grade 5 slots only). steerNote reads Section A's reply tree and writes the note the other
 * sections' prompts carry.
 */

const { steerNote } = require('../../bot/shared/services/assessment/fde-mid-steer');

const tree = {
  unseen: {
    objective: {
      MCQs: [
        { slot: 'g3.maths.A.mcq', question: 'What is 8 x 5?', options: ['a) 35', 'b) 40', 'c) 45'], answer: 'b) 40' },
        { slot: 'g3.maths.A.mcq', question: 'The answer of a multiplication is called the', options: ['a) sum', 'b) product'], answer: 'b) product' },
      ],
      'Match Columns': [{ slot: 'g3.general_knowledge.A.match', question: 'کالم الف کو کالم ب سے ملائیں۔', column_a: ['گھر'], column_b: ['کھلونا'], answer: 'گھر: کھلونا' }],
      'Fill in the Blanks': [{ slot: 'g3.general_knowledge.A.fill', question: 'پاکستان کا دارالحکومت ___ ہے۔', answer: 'اسلام آباد', words: ['اسلام آباد', 'لاہور'] }],
    },
  },
};

test('lists every Section A item as question and answer, with its options or its match pair', () => {
  const note = steerNote(tree);
  expect(note).toContain('Section A of this paper is already written.');
  expect(note).toContain('- What is 8 x 5? — 40 [options: 35, 40, 45]');
  expect(note).toContain('- The answer of a multiplication is called the — product [options: sum, product]');
  expect(note).toContain('- گھر — کھلونا');
  expect(note).toContain('- پاکستان کا دارالحکومت ___ ہے۔ — اسلام آباد');
});

test('tells the section never to ask these facts again, in any shape', () => {
  const note = steerNote(tree);
  expect(note).toContain('Never ask any of these facts again in your section');
  expect(note).toContain('no stem, option, blank or passage question may ask for or print one of these answers');
  expect(note).toContain('Test different facts, words and numbers from the same chapter.');
});

test('an empty or broken tree gives no note', () => {
  expect(steerNote(null)).toBeNull();
  expect(steerNote({ unseen: {} })).toBeNull();
  expect(steerNote({ unseen: { objective: { MCQs: [null, 2, { question: '' }] } } })).toBeNull();
});
