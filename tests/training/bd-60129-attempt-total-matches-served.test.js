/**
 * bd-60129 — an attempt's total_questions must be the SERVED paper, not the bank.
 *
 * Reported from sandbox: the CRQ arrived, the teacher typed a real answer, and
 * it was picked up by the generic LLM chat reply instead of being recorded and
 * marked.
 *
 * MY BUG, and it compounds:
 *
 *   1. startModuleExam wrote `total_questions: bank.length` — 12 for Module 1
 *      (8 MCQs + all four CRQs) — when the paper it means to serve is NINE
 *      (8 MCQs + one CRQ).
 *
 *   2. loadServedQuestions compares that snapshot against what it would serve
 *      and, when they disagree, concludes the attempt "predates serving
 *      selection" and falls back to the FULL bank. So the mismatch silently
 *      turned the one-CRQ rule off.
 *
 *   3. With 12 questions served, index 8 was the first of four CRQs rather than
 *      the single drawn one, and every downstream check read a different
 *      question than the teacher was looking at — so the text answer was never
 *      claimed and fell through to ordinary chat.
 *
 * The fix is to size the attempt from the served paper. These assertions pin
 * the arithmetic, because the failure was silent: nothing errored, the teacher
 * simply got a chat reply instead of a score.
 */

const {
  MODULE_EXAM_MCQ_COUNT,
  selectPaperWithOneCrq,
  isOpenEndedQuestion,
} = require('../../bot/shared/services/training/isaps-crq-paper.rules');

const MCQ = (id, order) => ({
  id, order_index: order, question_text: `mcq ${id}`,
  options: ['a', 'b', 'c', 'd'], correct_option: '2',
});
const CRQ = (id, order) => ({
  id, order_index: order, question_text: `crq ${id}`,
  options: [], correct_option: '',
});

// Module 1 exactly as it sits in sandbox: 8 MCQs, then 4 CRQs.
const BANK = [
  MCQ(1, 1), MCQ(2, 2), MCQ(3, 3), MCQ(4, 4),
  MCQ(5, 5), MCQ(6, 6), MCQ(7, 7), MCQ(8, 8),
  CRQ(101, 901), CRQ(102, 902), CRQ(103, 903), CRQ(104, 904),
];

describe('bd-60129 — the served paper is what the attempt must be sized to', () => {
  // bd-60141 changed the paper from "every MCQ + 1 CRQ" to "2 MCQs + 1 CRQ",
  // so the fixed counts below moved. The INVARIANT this file exists for is
  // untouched and is what the assertions now express: the attempt must be
  // sized to the SERVED paper, never to the bank, because the teacher's
  // question index addresses the paper.

  test('the bank is 12 but the paper is 3 — the numbers, after bd-60141', () => {
    expect(BANK).toHaveLength(12);
    expect(selectPaperWithOneCrq(BANK, 'attempt-a')).toHaveLength(3);
  });

  test('the paper is always SHORTER than the bank — sizing to the bank is the bug', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(selectPaperWithOneCrq(BANK, `attempt-${i}`).length).toBeLessThan(BANK.length);
    }
  });

  test('the LAST served index is the CRQ', () => {
    const paper = selectPaperWithOneCrq(BANK, 'attempt-a');
    expect(isOpenEndedQuestion(paper[paper.length - 1])).toBe(true);
  });

  test('exactly one CRQ is served — four would break the index contract', () => {
    const paper = selectPaperWithOneCrq(BANK, 'attempt-a');
    expect(paper.filter(isOpenEndedQuestion)).toHaveLength(1);
  });

  test('the paper index addresses the PAPER, not the bank', () => {
    // The original defect: the question at the teacher's index was not the
    // question the code inspected, because one indexed the paper and the
    // other the bank. With a sampled paper they diverge immediately.
    const paper = selectPaperWithOneCrq(BANK, 'attempt-zzz');
    const lastIdx = paper.length - 1;
    expect(isOpenEndedQuestion(paper[lastIdx])).toBe(true);
    // Same ordinal read off the bank is NOT the same question.
    expect(BANK[lastIdx].id).not.toBe(paper[lastIdx].id);
    expect(BANK.filter(isOpenEndedQuestion)).toHaveLength(4);
  });

  test('a module with no CRQ sizes to its sampled MCQs', () => {
    const mcqOnly = BANK.filter(q => !isOpenEndedQuestion(q));
    expect(selectPaperWithOneCrq(mcqOnly, 'a')).toHaveLength(MODULE_EXAM_MCQ_COUNT);
  });

  test('every module shape in sandbox sizes to the same 3 — including the thin one', () => {
    // M6 is the thin one (1 MCQ in the real bank) and M8 the fat one (12).
    // A fat bank now sizes to 3 like every other; a bank thinner than the
    // quota serves what it has, which is why M6 is asserted separately.
    for (const mcqCount of [2, 5, 7, 8, 9, 10, 12]) {
      const bank = [];
      for (let i = 1; i <= mcqCount; i += 1) bank.push(MCQ(i, i));
      for (let i = 1; i <= 4; i += 1) bank.push(CRQ(900 + i, 900 + i));
      expect(selectPaperWithOneCrq(bank, `a-${mcqCount}`)).toHaveLength(3);
    }
    // The real Module 6: a single MCQ in the bank cannot yield two.
    const thin = [MCQ(1, 1), CRQ(901, 901), CRQ(902, 902)];
    expect(selectPaperWithOneCrq(thin, 'a-thin')).toHaveLength(2);
  });
});
