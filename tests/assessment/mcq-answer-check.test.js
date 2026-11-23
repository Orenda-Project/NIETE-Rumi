// bd-rzjnjp.1.1 — an option question's answer must be one of its options, and a
// paper carries no MSQs she did not ask for. Round 3: Haiku failed D6 on 11 papers
// with unrequested MSQs, multi-answer Circle items and explanations after the answer.
jest.mock('../../bot/shared/services/llm-client', () => ({ createChatCompletion: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }),);

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const { checkMcqAnswers } = require('../../bot/shared/services/assessment/mcq-answer-check');

const OPTS = ['a) 2', 'b) 4', 'c) 6', 'd) 8'];
const mcq = (answer, extra = {}) => ({ question: '2 + 2 = ?', options: [...OPTS], answer, marks: 1, ...extra });
const paper = (objective, section = 'unseen') => ({ [section]: { objective } });
const MCQ_ONLY = [{ id: 'MCQs', count: 5, category: 'objective' }];

describe('checkMcqAnswers: single-answer option questions', () => {
  test('an answer that is an option is kept as that option', () => {
    const exam = paper({ MCQs: [mcq('b) 4'), mcq('b')] });
    const out = checkMcqAnswers(exam, { askedTypes: MCQ_ONLY });
    expect(exam.unseen.objective.MCQs.map((q) => q.answer)).toEqual(['b) 4', 'b) 4']);
    expect(out.droppedMismatch).toBe(0);
  });

  test('an explanation after the option is stripped to the option', () => {
    const exam = paper({ MCQs: [mcq('b) 4 — because two and two make four')] });
    const out = checkMcqAnswers(exam, { askedTypes: MCQ_ONLY });
    expect(exam.unseen.objective.MCQs[0].answer).toBe('b) 4');
    expect(out.stripped).toBe(1);
  });

  test('an answer naming two options is dropped', () => {
    const exam = paper({ MCQs: [mcq('b) 4, c) 6'), mcq('b) 4')] });
    const out = checkMcqAnswers(exam, { askedTypes: MCQ_ONLY });
    expect(exam.unseen.objective.MCQs).toHaveLength(1);
    expect(out.droppedMismatch).toBe(1);
  });

  test('an answer naming no option is dropped', () => {
    const exam = paper({ MCQs: [mcq('five')] });
    checkMcqAnswers(exam, { askedTypes: MCQ_ONLY });
    expect(exam.unseen.objective.MCQs).toHaveLength(0);
  });

  test('an item with no answer (key off) is left alone', () => {
    const q = mcq(undefined); delete q.answer;
    const exam = paper({ MCQs: [q] });
    checkMcqAnswers(exam, { askedTypes: MCQ_ONLY });
    expect(exam.unseen.objective.MCQs).toHaveLength(1);
  });

  test('a fill-in with two blanks and a word bank is not treated as an MCQ', () => {
    const q = { question: 'The ___ is red and the ___ is blue.', options: ['sky', 'apple'], answer: 'apple, sky' };
    const exam = paper({ 'Fill in the blanks': [q] });
    checkMcqAnswers(exam, { askedTypes: [{ id: 'Fill in the blanks', count: 1, category: 'objective' }] });
    expect(exam.unseen.objective['Fill in the blanks']).toHaveLength(1);
  });
});

describe('checkMcqAnswers: MSQs', () => {
  test('unseen MSQs she did not ask for are dropped', () => {
    const exam = paper({ MCQs: [mcq('b) 4')], MSQs: [mcq('b) 4, d) 8')] });
    const out = checkMcqAnswers(exam, { askedTypes: MCQ_ONLY });
    expect(exam.unseen.objective.MSQs).toBeUndefined();
    expect(out.droppedUnrequestedMsq).toBe(1);
  });

  test('seen MSQs (from the book) are kept, answers set to the exact options', () => {
    const exam = paper({ MSQs: [mcq('b, d')] }, 'seen');
    const out = checkMcqAnswers(exam, { askedTypes: MCQ_ONLY });
    expect(exam.seen.objective.MSQs[0].answer).toBe('b) 4, d) 8');
    expect(out.msqFixed).toBe(1);
  });

  test('requested MSQs are kept; one with a part that is no option is dropped', () => {
    const exam = paper({ MSQs: [mcq('b) 4 and d) 8'), mcq('b) 4, ten')] });
    const out = checkMcqAnswers(exam, { askedTypes: [{ id: 'MSQs', count: 2, category: 'objective' }] });
    expect(exam.unseen.objective.MSQs.map((q) => q.answer)).toEqual(['b) 4, d) 8']);
    expect(out.droppedMismatch).toBe(1);
  });
});

describe('buildUserPrompt: one right option, no unasked types', () => {
  const ARGS = { grade: 3, subject: 'Maths', pageContent: 'x', pageReference: 'p1', contentSource: 'unseen', questionCount: 5 };
  test('says every MCQ has exactly one correct option and its answer is that option', () => {
    const p = Gen.buildUserPrompt({ ...ARGS, questionTypes: MCQ_ONLY });
    expect(p).toMatch(/exactly one correct option/);
    expect(p).toMatch(/no MSQs/);
  });
  test('does not forbid MSQs when she asked for them', () => {
    const p = Gen.buildUserPrompt({ ...ARGS, questionTypes: [{ id: 'MSQs', count: 5, category: 'objective' }] });
    expect(p).not.toMatch(/no MSQs/);
  });
});
