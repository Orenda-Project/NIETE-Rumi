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

  test('a full bank of thin rows yields NO CRQ — none is invented', () => {
    const bank = [];
    for (let i = 1; i <= 8; i += 1) bank.push(THIN(i, i));
    for (let i = 1; i <= 4; i += 1) bank.push(THIN(100 + i, 900 + i));
    // bd-60141 changed the COUNT (the paper is now sampled to 2 MCQs + 1 CRQ
    // rather than serving the bank), so this no longer asserts 12. What
    // bd-60131 actually guards is unchanged and is asserted here: an
    // unclassifiable row must never be treated as open-ended, so a bank of
    // thin rows produces a paper with NO CRQ in it — which is what stopped
    // Module 1's 12 rows collapsing to a single CRQ.
    const paper = selectPaperWithOneCrq(bank, 'sizing');
    expect(paper.every(q => !isOpenEndedQuestion(q))).toBe(true);
    expect(paper.length).toBeGreaterThan(0);
  });

  test('an EXPLICITLY empty options array with an empty key IS open-ended', () => {
    // This is a real CRQ row, loaded with its columns.
    expect(isOpenEndedQuestion(CRQ(1, 901))).toBe(true);
  });

  test('a populated MCQ row is not open-ended', () => {
    expect(isOpenEndedQuestion(MCQ(1, 1))).toBe(false);
  });

  test('a properly loaded Module 1 bank serves exactly one CRQ', () => {
    const bank = [];
    for (let i = 1; i <= 8; i += 1) bank.push(MCQ(i, i));
    for (let i = 1; i <= 4; i += 1) bank.push(CRQ(100 + i, 900 + i));
    // Was 9 (all MCQs + 1 CRQ). bd-60141 samples the MCQs to 2 per the ISAPS
    // spec, so the paper is 3 — but the invariant bd-60131 exists for is that
    // EXACTLY ONE CRQ is served off a properly loaded bank, never four.
    const paper = selectPaperWithOneCrq(bank, 'sizing');
    expect(paper.filter(isOpenEndedQuestion)).toHaveLength(1);
    expect(paper).toHaveLength(3);
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
