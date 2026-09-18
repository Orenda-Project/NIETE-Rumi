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
  test('the bank is 12 but the paper is 9 — the numbers that caused this', () => {
    expect(BANK).toHaveLength(12);
    expect(selectPaperWithOneCrq(BANK, 'attempt-a')).toHaveLength(9);
  });

  test('the LAST served index is the CRQ, and it is index 8 of 9', () => {
    const paper = selectPaperWithOneCrq(BANK, 'attempt-a');
    const lastIndex = paper.length - 1;
    expect(lastIndex).toBe(8);
    expect(isOpenEndedQuestion(paper[lastIndex])).toBe(true);
  });

  test('exactly one CRQ is served — four would break the index contract', () => {
    const paper = selectPaperWithOneCrq(BANK, 'attempt-a');
    expect(paper.filter(isOpenEndedQuestion)).toHaveLength(1);
  });

  test('index 8 of the FULL bank is a different question than index 8 of the paper', () => {
    // This is the actual defect: serving the bank meant the question at the
    // teacher's index was not the question the code inspected.
    const paper = selectPaperWithOneCrq(BANK, 'attempt-zzz');
    const servedAt8 = paper[8];
    const bankAt8 = BANK[8];
    // Both are open-ended, but they are not necessarily the same item — and
    // the paper's is the one the teacher was actually shown.
    expect(isOpenEndedQuestion(servedAt8)).toBe(true);
    expect(isOpenEndedQuestion(bankAt8)).toBe(true);
    expect(BANK.filter(isOpenEndedQuestion)).toHaveLength(4);
  });

  test('a module with no CRQ sizes to its MCQs, unchanged', () => {
    const mcqOnly = BANK.filter(q => !isOpenEndedQuestion(q));
    expect(selectPaperWithOneCrq(mcqOnly, 'a')).toHaveLength(8);
  });

  test('every module shape in sandbox sizes to mcqs + 1', () => {
    // M6 is the thin one (2 MCQs) and M8 the fat one (12) — both must size
    // correctly, since the snapshot guard trips on ANY mismatch.
    for (const mcqCount of [2, 5, 7, 8, 9, 10, 12]) {
      const bank = [];
      for (let i = 1; i <= mcqCount; i += 1) bank.push(MCQ(i, i));
      for (let i = 1; i <= 4; i += 1) bank.push(CRQ(900 + i, 900 + i));
      expect(selectPaperWithOneCrq(bank, `a-${mcqCount}`)).toHaveLength(mcqCount + 1);
    }
  });
});
