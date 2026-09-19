/**
 * bd-60141 — an I-SAPS module exam is 2 MCQs + 1 CRQ, sampled from the bank.
 *
 * Operator caught this on sandbox: the Module 9 exam served TEN questions.
 *
 * The ISAPS process document, §5.1, is explicit about the size of a module's
 * summative paper:
 *
 *   "The Summative Assessment score is itself calculated for two Scenario-Based
 *    MCQs (2 marks @ 1 mark for each MCQ) and one CRQ (10 marks)."
 *
 * So a module exam is THREE questions worth TWELVE marks — not the whole bank.
 *
 * The source files confirm the bank-per-module reading, and the distinction is
 * visible in their own column headers:
 *
 *   formative sheet → "Place After Unit" (101, 102, …)  — bound to ONE unit
 *   summative sheet → "Scene No." + "…Items Bank"        — scoped to the MODULE
 *
 * Module 1's bank holds 8 MCQs and 4 CRQs; Module 9's holds 9 and 4. Those are
 * a POOL to draw from, which is also what makes §5.5 work — a failed attempt is
 * re-sat with "a new set of CRQs" — rather than a paper to sit end to end.
 *
 * buildMixedPaper implemented the one-CRQ half of the rule and passed every MCQ
 * straight through, which is how a 9-MCQ bank became a 10-question exam.
 *
 * Selection is seeded on the ATTEMPT ID, so:
 *   - resuming an interrupted exam re-derives the SAME paper (the served set is
 *     stored nowhere; every path recomputes it), and
 *   - a re-sit is a new attempt, so it draws a fresh paper, per §5.5.
 */

const {
  buildMixedPaper,
  selectPaperWithOneCrq,
  MODULE_EXAM_MCQ_COUNT,
} = require('../../bot/shared/services/training/isaps-crq-paper.rules');

const MCQ = (id) => ({ id, options: ['a', 'b', 'c', 'd'], correct_option: '2' });
const CRQ = (id) => ({ id, options: [], correct_option: '' });

/** Module 1's real bank shape: 8 MCQs + 4 CRQs. */
const bankM1 = () => [
  ...Array.from({ length: 8 }, (_, i) => MCQ(i + 1)),
  ...Array.from({ length: 4 }, (_, i) => CRQ(100 + i)),
];
/** Module 9's real bank shape: 9 MCQs + 4 CRQs — the one that served 10. */
const bankM9 = () => [
  ...Array.from({ length: 9 }, (_, i) => MCQ(i + 1)),
  ...Array.from({ length: 4 }, (_, i) => CRQ(100 + i)),
];

const isCrq = (q) => Array.isArray(q.options) && q.options.length === 0;

describe('bd-60141 — the paper is 2 MCQs + 1 CRQ', () => {
  test('THE BUG: Module 9 served 10 questions, not 3', () => {
    expect(selectPaperWithOneCrq(bankM9(), 'attempt-a')).toHaveLength(3);
  });

  test('Module 1 (8 MCQs + 4 CRQs) also yields exactly 3', () => {
    expect(selectPaperWithOneCrq(bankM1(), 'attempt-a')).toHaveLength(3);
  });

  test('the composition is exactly 2 MCQs and 1 CRQ', () => {
    const paper = selectPaperWithOneCrq(bankM9(), 'attempt-a');
    expect(paper.filter(q => !isCrq(q))).toHaveLength(2);
    expect(paper.filter(isCrq)).toHaveLength(1);
  });

  test('the CRQ is LAST — it is the typed question the teacher ends on', () => {
    const paper = selectPaperWithOneCrq(bankM9(), 'attempt-a');
    expect(isCrq(paper[paper.length - 1])).toBe(true);
    expect(paper.slice(0, -1).every(q => !isCrq(q))).toBe(true);
  });

  test('the count is named, not a magic number', () => {
    expect(MODULE_EXAM_MCQ_COUNT).toBe(2);
  });
});

describe('bd-60141 — selection is stable per attempt, fresh per re-sit', () => {
  test('the SAME attempt id re-derives the SAME paper', () => {
    // Load-bearing: the served set is stored nowhere, so sendQuestion,
    // the sizing pass and grading each recompute it. If these disagreed, a
    // resumed exam would serve a different question than the one it scored.
    const a = selectPaperWithOneCrq(bankM9(), 'attempt-a').map(q => q.id);
    const b = selectPaperWithOneCrq(bankM9(), 'attempt-a').map(q => q.id);
    expect(a).toEqual(b);
  });

  test('a DIFFERENT attempt id can draw a different paper — §5.5 re-sits', () => {
    const ids = new Set();
    for (let i = 0; i < 12; i += 1) {
      ids.add(selectPaperWithOneCrq(bankM9(), `attempt-${i}`).map(q => q.id).join(','));
    }
    // Not asserting every draw differs (a small bank repeats by chance);
    // asserting the selection is not CONSTANT, which is what a re-sit needs.
    expect(ids.size).toBeGreaterThan(1);
  });

  test('every drawn question actually comes from the bank', () => {
    const bank = bankM9();
    const allowed = new Set(bank.map(q => q.id));
    for (let i = 0; i < 20; i += 1) {
      for (const q of selectPaperWithOneCrq(bank, `attempt-${i}`)) {
        expect(allowed.has(q.id)).toBe(true);
      }
    }
  });

  test('no question is served twice in one paper', () => {
    for (let i = 0; i < 20; i += 1) {
      const ids = selectPaperWithOneCrq(bankM9(), `attempt-${i}`).map(q => q.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('bd-60141 — thin banks degrade safely rather than throwing', () => {
  test('a bank with only 1 MCQ serves that one, not a phantom second', () => {
    // Module 6 really does have a thin MCQ bank. Serving fewer is correct;
    // inventing a question, or crashing a live exam, is not.
    const paper = buildMixedPaper([MCQ(1)], [CRQ(100)], 'a');
    expect(paper).toHaveLength(2);
    expect(paper.filter(q => !isCrq(q))).toHaveLength(1);
  });

  test('a bank with NO CRQ still serves its MCQs', () => {
    const paper = buildMixedPaper([MCQ(1), MCQ(2), MCQ(3)], [], 'a');
    expect(paper).toHaveLength(2);
    expect(paper.every(q => !isCrq(q))).toBe(true);
  });

  test('an empty bank yields an empty paper, not a throw', () => {
    expect(buildMixedPaper([], [], 'a')).toEqual([]);
    expect(selectPaperWithOneCrq([], 'a')).toEqual([]);
  });

  test('bd-60131 still holds: a thin row is never CLASSIFIED as a CRQ', () => {
    // bd-60131 was about misclassification, not count: rows carrying neither
    // `options` nor `correct_option` must not be guessed open-ended, which is
    // what once collapsed Module 1's bank to a single CRQ.
    //
    // Under bd-60141 such a bank now samples down to the MCQ quota — every row
    // reads as non-open-ended, so 2 are drawn and no CRQ is appended. The
    // regression being guarded is "a CRQ appeared out of thin rows", and it
    // does not.
    const thin = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, order_index: i + 1 }));
    const paper = selectPaperWithOneCrq(thin, 'sizing');
    expect(paper).toHaveLength(MODULE_EXAM_MCQ_COUNT);
    expect(paper.every(q => !isCrq(q))).toBe(true);

    // And the real guarantee that made bd-60131 safe: loadQuestionBank selects
    // options + correct_option, so a live bank is never this shape.
  });
});
