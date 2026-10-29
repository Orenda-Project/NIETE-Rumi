/**
 * bd-6clakk.12.3 — the writer is told her ticked stems, and the paper is checked for them.
 * A stem is the shared instruction a group prints once (main_question), so each question of a type
 * with stems must carry one of them, word for word.
 */
const { stemsBlock, applyStems } = require('../../../bot/shared/services/assessment/topics/stem-prompt');

const FILL = { id: 'Fill in the Blanks', count: 3, category: 'objective',
  stems: ['Fill in the blanks with is, am or are.', 'Fill in the blanks with has or have.'] };
const MCQ = { id: 'MCQs', count: 2, category: 'objective' };

describe('stemsBlock', () => {
  test('no type carries stems: empty, so every other prompt is unchanged', () => {
    expect(stemsBlock([MCQ])).toBe('');
    expect(stemsBlock([])).toBe('');
    expect(stemsBlock(undefined)).toBe('');
  });

  test('names the type and every ticked stem, word for word, as main_question', () => {
    const block = stemsBlock([FILL, MCQ]);
    expect(block).toMatch(/Fill in the Blanks/);
    for (const s of FILL.stems) expect(block).toContain(`"${s}"`);
    expect(block).toMatch(/main_question/);
    expect(block).not.toMatch(/MCQs/);
  });
});

describe('applyStems', () => {
  const paper = (mains) => ({
    unseen: { objective: {
      'Fill in the Blanks': mains.map((m, i) => ({ main_question: m, question: `q${i}`, answer: 'is', marks: 1 })),
      MCQs: [{ main_question: 'Choose the correct answer.', question: 'x', options: ['a', 'b'], marks: 1 }],
    } },
  });

  test('a stem written with different case, spacing or end mark is set to the stem exactly', () => {
    const exam = paper(['fill in the blanks with is,  am or are', 'Fill in the blanks with has or have.']);
    const { misses } = applyStems(exam, [FILL, MCQ]);
    expect(misses).toEqual([]);
    expect(exam.unseen.objective['Fill in the Blanks'][0].main_question).toBe(FILL.stems[0]);
  });

  test('the writer keys the type "Fill in the blanks" (sandbox, G1 English): still checked and snapped', () => {
    const exam = { unseen: { objective: { 'Fill in the blanks': [
      { main_question: 'fill in the blanks with is, am or are', question: 'q', marks: 1 },
      { main_question: 'Fill in the blanks.', question: 'q', marks: 1 },
    ] } } };
    const { misses } = applyStems(exam, [FILL]);
    expect(exam.unseen.objective['Fill in the blanks'][0].main_question).toBe(FILL.stems[0]);
    expect(misses).toEqual([{ type: 'Fill in the Blanks', main_question: 'Fill in the blanks.' }]);
  });

  test('a question that uses no ticked stem is reported, and left as written', () => {
    const exam = paper(['Fill in the blanks.', FILL.stems[1]]);
    const { misses } = applyStems(exam, [FILL, MCQ]);
    expect(misses).toEqual([{ type: 'Fill in the Blanks', main_question: 'Fill in the blanks.' }]);
    expect(exam.unseen.objective['Fill in the Blanks'][0].main_question).toBe('Fill in the blanks.');
  });

  test('types without stems are not checked; a paper with none is untouched', () => {
    const exam = paper([FILL.stems[0]]);
    const before = JSON.stringify(exam);
    expect(applyStems(exam, [MCQ]).misses).toEqual([]);
    expect(JSON.stringify(exam)).toBe(before);
  });

  test('Urdu: the full stop ۔ counts as an end mark', () => {
    const UR = { id: 'MCQs', count: 1, category: 'objective', stems: ['درست جواب پر دائرہ لگائیں۔'] };
    const exam = { unseen: { objective: { MCQs: [{ main_question: 'درست جواب پر دائرہ لگائیں', question: 'x' }] } } };
    expect(applyStems(exam, [UR]).misses).toEqual([]);
    expect(exam.unseen.objective.MCQs[0].main_question).toBe(UR.stems[0]);
  });

  test('a missing or odd paper does not throw', () => {
    expect(applyStems(null, [FILL]).misses).toEqual([]);
    expect(applyStems({ unseen: { objective: { 'Fill in the Blanks': 'x' } } }, [FILL]).misses).toEqual([]);
  });
});

describe('the writer prompt', () => {
  jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  const { buildUserPrompt } = require('../../../bot/shared/services/assessment/assessment-generation.service');
  const args = (types) => ({ grade: 1, subject: 'english', pageContent: 'text', pageReference: 'p1',
    contentSource: 'unseen', questionCount: 5, questionTypes: types });

  test('carries her stems when she ticked some', () => {
    expect(buildUserPrompt(args([FILL, MCQ]))).toContain(stemsBlock([FILL, MCQ]));
  });

  test('without stems the prompt is exactly the one without the field', () => {
    const plain = { ...FILL };
    delete plain.stems;
    expect(buildUserPrompt(args([{ ...FILL, stems: [] }, MCQ]))).toBe(buildUserPrompt(args([plain, MCQ])));
    expect(buildUserPrompt(args([plain, MCQ]))).not.toMatch(/QUESTION INSTRUCTIONS/);
  });
});
