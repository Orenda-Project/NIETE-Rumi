/**
 * v37r5 G5 Science Q2 (a) (bd-5jmnfj.4.58.9.1): Section B is answered on the answer sheet, so the paper prints
 * no frame, yet both stems said "Draw ... in the frame below".
 */
const { answerSheetWording } = require('../../bot/shared/services/assessment/fde-answer-sheet-wording');
const { keyFixes } = require('../../bot/shared/services/assessment/fde-g5-key-fixes');

const exam = (answerOn) => ({
  _layout: { sections: [{ id: 'B', answer_on: answerOn, slots: [{ slot: 'science.B.Q2a' }] }] },
  unseen: { subjective: { 'Draw and Label': [
    { slot: 'science.B.Q2a', question: 'Food Chain. Draw a food chain of four living things in the frame below, starting with a plant.', frame: true },
    { slot: 'science.B.Q2a', question: 'Respiratory System. Draw the system in the box below. Label any 5 parts.' },
  ] } },
});
const items = (ex) => ex.unseen.subjective['Draw and Label'];

describe('stems in an answer-sheet section never point at a frame on the paper', () => {
  test('"in the frame below" and "in the box below" become "on your answer sheet"', () => {
    const { examJson, notes } = answerSheetWording(exam('answer_sheet'));
    expect(items(examJson)[0].question).toBe('Food Chain. Draw a food chain of four living things on your answer sheet, starting with a plant.');
    expect(items(examJson)[1].question).toBe('Respiratory System. Draw the system on your answer sheet. Label any 5 parts.');
    expect(items(examJson)[0].frame).toBeUndefined();
    expect(notes).toHaveLength(2);
  });

  test('a section answered on the question paper keeps its frame wording', () => {
    const { examJson, notes } = answerSheetWording(exam('question_paper'));
    expect(items(examJson)[0].question).toMatch(/in the frame below/);
    expect(notes).toEqual([]);
  });

  test('keyFixes applies it on a G5 paper', () => {
    expect(items(keyFixes(exam('answer_sheet')).examJson)[0].question).toMatch(/on your answer sheet/);
  });
});
