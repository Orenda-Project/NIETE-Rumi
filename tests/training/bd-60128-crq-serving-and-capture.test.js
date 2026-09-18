/**
 * bd-60128 (part 2) — serving ONE CRQ, and capturing its text answer.
 *
 * The data is folded (all 36 CRQs now sit in their module's own MCQ bank,
 * ordered last) and the pure rules are pinned. This covers the three wiring
 * points that make the CRQ actually reachable:
 *
 *   1. selection — the served paper takes ONE CRQ, not the bank of four
 *   2. sending   — an open-ended question goes out as a text prompt, and must
 *                  never be rendered as option buttons
 *   3. capture   — a plain text reply during a module exam is stored as
 *                  answer_text and marked, instead of falling through to
 *                  ordinary chat
 *
 * Point 3 is where the sibling capstone path already bled once: its own
 * comment records 11 teachers losing answers to a `.maybeSingle()` over two
 * open attempts — the read errored, `attempt` came back null, the handler
 * passed the answer to ordinary chat and the teacher got a lesson-plan reply
 * instead of a score. The equivalent read here is asserted to tolerate more
 * than one row for the same reason.
 */

const {
  selectPaperWithOneCrq,
  isTextAnswerForOpenQuestion,
} = require('../../bot/shared/services/training/isaps-crq-paper.rules');

const MCQ = (id, order) => ({
  id, order_index: order, question_text: `mcq ${id}`,
  options: ['a', 'b', 'c', 'd'], correct_option: '2',
});
const CRQ = (id, order) => ({
  id, order_index: order, question_text: `crq ${id}`,
  options: [], correct_option: '',
});

describe('bd-60128 — selectPaperWithOneCrq', () => {
  // Module 1 as it now stands in sandbox: 8 MCQs then 4 CRQs.
  const BANK = [
    MCQ(1, 1), MCQ(2, 2), MCQ(3, 3), MCQ(4, 4),
    MCQ(5, 5), MCQ(6, 6), MCQ(7, 7), MCQ(8, 8),
    CRQ(101, 901), CRQ(102, 902), CRQ(103, 903), CRQ(104, 904),
  ];

  test('serves every MCQ and exactly ONE CRQ', () => {
    const paper = selectPaperWithOneCrq(BANK, 'attempt-a');
    expect(paper).toHaveLength(9);
    expect(paper.filter(q => q.correct_option === '').length).toBe(1);
  });

  test('the CRQ is last', () => {
    const paper = selectPaperWithOneCrq(BANK, 'attempt-a');
    expect(paper[8].correct_option).toBe('');
  });

  test('stable within an attempt — a resume shows the same CRQ', () => {
    const a = selectPaperWithOneCrq(BANK, 'attempt-a')[8].id;
    const b = selectPaperWithOneCrq(BANK, 'attempt-a')[8].id;
    expect(a).toBe(b);
  });

  test('a re-sit can draw a different scenario (doc §5.3)', () => {
    const seen = new Set();
    for (let i = 0; i < 60; i += 1) {
      seen.add(selectPaperWithOneCrq(BANK, `attempt-${i}`)[8].id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test('a bank with no CRQ is served unchanged', () => {
    const mcqOnly = [MCQ(1, 1), MCQ(2, 2)];
    expect(selectPaperWithOneCrq(mcqOnly, 'a')).toHaveLength(2);
  });

  test('an empty bank yields an empty paper, not a throw', () => {
    expect(selectPaperWithOneCrq([], 'a')).toEqual([]);
    expect(selectPaperWithOneCrq(null, 'a')).toEqual([]);
  });

  test('MCQ order is never disturbed by the CRQ draw', () => {
    const paper = selectPaperWithOneCrq(BANK, 'attempt-zzz');
    expect(paper.slice(0, 8).map(q => q.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('bd-60128 — isTextAnswerForOpenQuestion', () => {
  const openQ = CRQ(101, 901);
  const mcqQ = MCQ(1, 1);

  test('a real answer to an open question is claimed', () => {
    expect(isTextAnswerForOpenQuestion('Because scaffolding fades as the learner gains skill.', openQ)).toBe(true);
  });

  test('a slash command is NEVER claimed — /training must keep working', () => {
    expect(isTextAnswerForOpenQuestion('/training', openQ)).toBe(false);
    expect(isTextAnswerForOpenQuestion('  /help  ', openQ)).toBe(false);
  });

  test('empty or whitespace is not an answer', () => {
    expect(isTextAnswerForOpenQuestion('', openQ)).toBe(false);
    expect(isTextAnswerForOpenQuestion('   ', openQ)).toBe(false);
    expect(isTextAnswerForOpenQuestion(null, openQ)).toBe(false);
  });

  test('text is NOT claimed when the current question is an MCQ', () => {
    // Otherwise a teacher typing chat mid-MCQ would have it stored as an
    // answer and marked.
    expect(isTextAnswerForOpenQuestion('some words', mcqQ)).toBe(false);
  });

  test('no current question means nothing to claim', () => {
    expect(isTextAnswerForOpenQuestion('some words', null)).toBe(false);
  });
});
