/**
 * bd-ipoxhx.7 — ICT Feedback, Assessment Generator row 21 (Hafsa, with her teachers):
 * "Objective questions should have standardized marks, preferably 1 mark each … some objective
 * questions appear with 5 or 6 marks. Short questions: 2–3 marks. Long questions: 5–10 marks."
 *
 * The model chose every mark itself. standardMarks sets them to the standard after generation,
 * before the marks budget is checked, so a teacher no longer re-marks a 100-mark paper by hand.
 */

const { standardMarks } = require('../../bot/shared/services/assessment/standard-marks');

const marksOf = (list) => list.map((q) => q.marks);

describe('standardMarks — the marks a teacher expects, whatever the model wrote', () => {
  test('every objective question is worth 1 mark (MCQs, MSQs, blanks, True/False)', () => {
    const exam = { unseen: { objective: {
      MCQs: [{ question: 'a', marks: 5 }, { question: 'b', marks: 1 }],
      MSQs: [{ question: 'c', marks: 2 }],
      'Fill in the Blanks': [{ question: 'd', marks: 6 }],
      'True/False': [{ question: 'e' }],
    } } };
    standardMarks(exam);
    const o = exam.unseen.objective;
    expect([...marksOf(o.MCQs), ...marksOf(o.MSQs), ...marksOf(o['Fill in the Blanks']), ...marksOf(o['True/False'])])
      .toEqual([1, 1, 1, 1, 1]);
  });

  test('a matching question is worth 1 mark per pair', () => {
    const exam = { seen: { objective: { 'Match the Column': [
      { question: 'm', column_a: ['Dog', 'Cat', 'Cow'], column_b: ['x', 'y', 'z'], marks: 6 },
    ] } } };
    standardMarks(exam);
    expect(exam.seen.objective['Match the Column'][0].marks).toBe(3);
  });

  test('short / brief answers sit between 2 and 3 marks', () => {
    const exam = { unseen: { subjective: {
      'Brief Answers': [{ question: 'a', marks: 1 }, { question: 'b', marks: 3 }, { question: 'c', marks: 6 }],
      'Short Questions': [{ question: 'd' }],
    } } };
    standardMarks(exam);
    expect(marksOf(exam.unseen.subjective['Brief Answers'])).toEqual([2, 3, 3]);
    expect(marksOf(exam.unseen.subjective['Short Questions'])).toEqual([2]);
  });

  test('long questions sit between 5 and 10 marks, nested sub-types included', () => {
    const exam = { unseen: { subjective: {
      'Long Question': { Describe: [{ question: 'a', marks: 2 }, { question: 'b', marks: 15 }, { question: 'c', marks: 8 }] },
      'Essay Writing': [{ question: 'd', marks: 3 }],
    } } };
    standardMarks(exam);
    expect(marksOf(exam.unseen.subjective['Long Question'].Describe)).toEqual([5, 10, 8]);
    expect(marksOf(exam.unseen.subjective['Essay Writing'])).toEqual([5]);
  });

  test('a long question marked by its parts is left to its parts', () => {
    const q = { question: 'a', marks: 2, questions: [{ question: 'i', marks: 2 }, { question: 'ii', marks: 4 }] };
    const exam = { unseen: { subjective: { 'Long Question': [q] } } };
    standardMarks(exam);
    expect(q.marks).toBe(2);
    expect(q.questions.map((s) => s.marks)).toEqual([2, 4]);
  });

  test('other subjective work (Mind Map, Label the Diagram) keeps its marks', () => {
    const exam = { unseen: { subjective: { 'Mind Map': [{ question: 'a', marks: 4 }] } } };
    standardMarks(exam);
    expect(exam.unseen.subjective['Mind Map'][0].marks).toBe(4);
  });

  test('a board-pattern paper (_layout) keeps its own marks', () => {
    const exam = { _layout: { sections: [] }, unseen: { objective: { MCQs: [{ question: 'a', marks: 5 }] } } };
    standardMarks(exam);
    expect(exam.unseen.objective.MCQs[0].marks).toBe(5);
  });

  test('returns how many marks it changed, and tolerates an empty tree', () => {
    expect(standardMarks(null)).toBe(0);
    const exam = { seen: { objective: { MCQs: [{ question: 'a', marks: 1 }, { question: 'b', marks: 4 }] } } };
    expect(standardMarks(exam)).toBe(1);
  });
});
