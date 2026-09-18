/**
 * bd-60131 — open-ended classification must not run on a thin bank row.
 *
 * Reported from sandbox: the module exam served "Q1/1" and resolved the module
 * immediately, showing a CRQ as the only question.
 *
 * MY BUG, and my earlier tests could not catch it because they used
 * fully-populated fixtures. `loadQuestionBank` selects a PROJECTION:
 *
 *     .select('id, order_index, bloom_level')
 *
 * No `options`, no `correct_option`. isOpenEndedQuestion asks "no options AND
 * no key?" — which is TRUE for every row of that projection. So all 12 rows of
 * Module 1's bank were classified as CRQs, selectPaperWithOneCrq kept exactly
 * one, and the attempt was sized to 1.
 *
 * The lesson is the one the repo's own TDD rule states: a test that never
 * executes the real call chain proves nothing. These assertions use the SHAPE
 * loadQuestionBank actually returns.
 *
 * The fix is for the classifier to refuse to guess on a row that carries no
 * answer-shape fields at all, and for the caller to load those fields when it
 * needs to classify.
 */

const {
  isOpenEndedQuestion,
  selectPaperWithOneCrq,
} = require('../../bot/shared/services/training/isaps-crq-paper.rules');

/** Exactly what loadQuestionBank returns — the projection, nothing else. */
const THIN = (id, order) => ({ id, order_index: order, bloom_level: null });

/** A row loaded WITH the answer-shape columns. */
const MCQ = (id, order) => ({
  id, order_index: order, options: ['a', 'b', 'c', 'd'], correct_option: '2',
});
const CRQ = (id, order) => ({
  id, order_index: order, options: [], correct_option: '',
});

describe('bd-60131 — a thin projection is not evidence of open-endedness', () => {
  test('a row with NO options/correct_option keys is not classified open-ended', () => {
    // The row simply does not say. Guessing "open-ended" here is what broke it.
    expect(isOpenEndedQuestion(THIN(1, 1))).toBe(false);
  });

  test('a full bank of thin rows serves them ALL, not one', () => {
    const bank = [];
    for (let i = 1; i <= 8; i += 1) bank.push(THIN(i, i));
    for (let i = 1; i <= 4; i += 1) bank.push(THIN(100 + i, 900 + i));
    // Nothing is classifiable, so nothing is dropped — 12 in, 12 out. The
    // caller must load the answer columns if it wants the one-CRQ rule.
    expect(selectPaperWithOneCrq(bank, 'sizing')).toHaveLength(12);
  });

  test('an EXPLICITLY empty options array with an empty key IS open-ended', () => {
    // This is a real CRQ row, loaded with its columns.
    expect(isOpenEndedQuestion(CRQ(1, 901))).toBe(true);
  });

  test('a populated MCQ row is not open-ended', () => {
    expect(isOpenEndedQuestion(MCQ(1, 1))).toBe(false);
  });

  test('a properly loaded Module 1 bank still serves 9', () => {
    const bank = [];
    for (let i = 1; i <= 8; i += 1) bank.push(MCQ(i, i));
    for (let i = 1; i <= 4; i += 1) bank.push(CRQ(100 + i, 900 + i));
    expect(selectPaperWithOneCrq(bank, 'sizing')).toHaveLength(9);
  });

  test('options present but key missing is open-ended — the image-CRQ guard', () => {
    // Deliberate: a question with option TEXT but no key cannot be
    // auto-marked, so it is answered in writing.
    expect(isOpenEndedQuestion({ options: [], correct_option: null })).toBe(true);
  });

  test('null options WITH a key is not open-ended', () => {
    expect(isOpenEndedQuestion({ options: null, correct_option: '3' })).toBe(false);
  });
});
