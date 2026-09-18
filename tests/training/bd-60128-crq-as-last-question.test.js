/**
 * bd-60128 — the CRQ is the module exam's LAST QUESTION, not a second engine.
 *
 * I first modelled the I-SAPS CRQs as a separate `capstone` quiz per module,
 * copying Beacon House's level-wide capstone. That inherited
 * loadCapstoneQuiz's level-scoped `.maybeSingle()`, which THROWS now that
 * I-SAPS carries nine capstones on one level — so the CRQ could not be
 * delivered at all.
 *
 * The operator's read was better: if a module has 8 scenario MCQs and one
 * written answer, the written answer is question 9. Everything needed is
 * already on the shared path —
 *
 *   answer_text / answer_score / feedback_text  on training_assessment_answers
 *   capstone_points_per_question                on training_vendors (bd-60113)
 *   scoreAnswer()                               exported, pure, LLM-backed
 *
 * — so folding the CRQ in removes an engine rather than adding one.
 *
 * Operator decision 2026-09-18: serve ONE CRQ per attempt from the module's
 * bank of four, so a re-sit draws a different scenario (assessment doc §5.3
 * asks for "a new set of CRQs").
 *
 * These are the pure rules: what an open-ended question looks like, how one is
 * drawn, and how a mixed paper is scored.
 */

const {
  isOpenEndedQuestion,
  pickOneCrq,
  buildMixedPaper,
  scoreMixedPaper,
} = require('../../bot/shared/services/training/isaps-crq-paper.rules');

const MCQ = (id, order) => ({
  id, order_index: order, question_text: `mcq ${id}`,
  options: ['a', 'b', 'c', 'd'], correct_option: '2',
});
const CRQ = (id, order) => ({
  id, order_index: order, question_text: `crq scenario ${id}`,
  options: [], correct_option: '',
});

describe('bd-60128 — isOpenEndedQuestion', () => {
  test('empty options AND empty key means open-ended', () => {
    expect(isOpenEndedQuestion(CRQ(1, 1))).toBe(true);
  });

  test('a normal MCQ is not open-ended', () => {
    expect(isOpenEndedQuestion(MCQ(1, 1))).toBe(false);
  });

  test('an image-option question is NOT open-ended — it has a key', () => {
    // bd-60118: options text is synthesised, the key is a real index.
    expect(isOpenEndedQuestion({
      options: ['Option 1', 'Option 2'], correct_option: '2',
    })).toBe(false);
  });

  test('null options with no key still reads as open-ended', () => {
    expect(isOpenEndedQuestion({ options: null, correct_option: null })).toBe(true);
  });

  test('missing input is not open-ended, and does not throw', () => {
    expect(isOpenEndedQuestion(null)).toBe(false);
    // bd-60131 — `{}` carries NEITHER field, which is a thin projection
    // (loadQuestionBank's select), not a CRQ. This assertion originally read
    // `true` and that encoded the bug: every bank row classified as
    // open-ended, so Module 1's paper collapsed from 9 questions to 1.
    expect(isOpenEndedQuestion({})).toBe(false);
  });
});

describe('bd-60128 — pickOneCrq', () => {
  const BANK = [CRQ(101, 91), CRQ(102, 92), CRQ(103, 93), CRQ(104, 94)];

  test('draws exactly one', () => {
    expect(pickOneCrq(BANK, 'attempt-a')).toHaveLength(1);
  });

  test('stable within an attempt — a resumed exam shows the same CRQ', () => {
    const a = pickOneCrq(BANK, 'attempt-a')[0].id;
    const b = pickOneCrq(BANK, 'attempt-a')[0].id;
    expect(a).toBe(b);
  });

  test('a different attempt can draw a different scenario', () => {
    // Not guaranteed per pair, but across many attempts every item appears —
    // that is what makes a re-sit a new set rather than the same question.
    const seen = new Set();
    for (let i = 0; i < 60; i += 1) seen.add(pickOneCrq(BANK, `attempt-${i}`)[0].id);
    expect(seen.size).toBeGreaterThan(1);
  });

  test('a bank of one returns it', () => {
    expect(pickOneCrq([CRQ(1, 91)], 'x')).toHaveLength(1);
  });

  test('an empty bank yields nothing rather than throwing', () => {
    expect(pickOneCrq([], 'x')).toEqual([]);
    expect(pickOneCrq(null, 'x')).toEqual([]);
  });
});

describe('bd-60128 — buildMixedPaper', () => {
  const MCQS = [MCQ(1, 1), MCQ(2, 2), MCQ(3, 3)];
  const CRQS = [CRQ(101, 91), CRQ(102, 92)];

  test('the CRQ comes LAST — the written answer closes the exam', () => {
    // bd-60141 — the paper is now SAMPLED to 2 MCQs + 1 CRQ, so its length is
    // 3 rather than every-MCQ + 1. What this test guards is position, not
    // size: the written answer must close the exam.
    const paper = buildMixedPaper(MCQS, CRQS, 'attempt-a');
    expect(paper).toHaveLength(3);
    expect(isOpenEndedQuestion(paper[paper.length - 1])).toBe(true);
    expect(paper.slice(0, -1).every(q => !isOpenEndedQuestion(q))).toBe(true);
  });

  test('MCQ order is preserved', () => {
    // bd-60141 — WHICH MCQs are drawn is sampled; the order they are ASKED in
    // is still the authored one. So this asserts ascending ids, not [1,2,3].
    const paper = buildMixedPaper(MCQS, CRQS, 'attempt-a');
    const mcqIds = paper.slice(0, -1).map(q => q.id);
    expect(mcqIds).toEqual([...mcqIds].sort((a, b) => a - b));
  });

  test('a module with no CRQ is just its MCQs — no empty slot', () => {
    // bd-60141 — "its MCQs" is now the 2 sampled ones, not all of them.
    expect(buildMixedPaper(MCQS, [], 'a')).toHaveLength(2);
  });

  test('a module with only a CRQ is a one-question paper', () => {
    const paper = buildMixedPaper([], CRQS, 'a');
    expect(paper).toHaveLength(1);
    expect(isOpenEndedQuestion(paper[0])).toBe(true);
  });
});

describe('bd-60128 — scoreMixedPaper', () => {
  test('MCQs count 1 each; the CRQ contributes its rubric mark', () => {
    const out = scoreMixedPaper({
      answers: [
        { question_index: 0, is_correct: true },
        { question_index: 1, is_correct: false },
        { question_index: 2, is_correct: true },
        { question_index: 3, answer_score: 7 },
      ],
      mcqCount: 3,
      crqMaxPoints: 10,
    });
    // 2 of 3 MCQs + 7 of 10 CRQ marks = 9 of 13
    expect(out.earned).toBe(9);
    expect(out.possible).toBe(13);
  });

  test('an unanswered CRQ scores zero, not undefined', () => {
    const out = scoreMixedPaper({
      answers: [{ question_index: 0, is_correct: true }],
      mcqCount: 1, crqMaxPoints: 10,
    });
    expect(out.earned).toBe(1);
    expect(out.possible).toBe(11);
  });

  test('a paper with no CRQ scores out of its MCQs alone', () => {
    const out = scoreMixedPaper({
      answers: [{ question_index: 0, is_correct: true }],
      mcqCount: 1, crqMaxPoints: 0,
    });
    expect(out.possible).toBe(1);
  });

  test('a CRQ mark above its cap is clamped, never inflating the score', () => {
    const out = scoreMixedPaper({
      answers: [{ question_index: 0, answer_score: 99 }],
      mcqCount: 0, crqMaxPoints: 10,
    });
    expect(out.earned).toBe(10);
    expect(out.possible).toBe(10);
  });

  test('no answers at all is 0 of the full paper', () => {
    const out = scoreMixedPaper({ answers: [], mcqCount: 3, crqMaxPoints: 10 });
    expect(out.earned).toBe(0);
    expect(out.possible).toBe(13);
  });
});
