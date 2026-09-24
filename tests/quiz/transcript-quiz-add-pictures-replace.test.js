'use strict';
/**
 * The add-pictures repair may REPLACE a question it cannot draw.
 *
 * Live, on a grade 4 Urdu lesson on comparing unlike fractions, the author
 * wrote eight PROCEDURAL questions (the cross products, the rewritten
 * fractions) and no picture. The repair bolted fraction bars onto three of
 * them, and all three were rightly refused: a bar of 2/3 beside "what is
 * 2 × 5?" cannot produce "10" (FIGURE_MISMATCH), so the quiz shipped with 0
 * pictures of the 3 it aims for. No picture can show the answer to a step of a
 * procedure. The repair may now replace such a question with a NEW question on
 * the same objective that is read off a picture ("what fraction of the bar is
 * shaded?", "which bar shows 3/5?").
 *
 * What a replacement may be is asserted in code: a whole, well-formed question
 * with a picture it is READ from (read_off / count_compare, never "model"), on
 * the replaced question's objective, never the easy first question. The merged
 * set is validated in full like every repair, and it runs BEFORE the key check
 * and the blind solve, so a replaced key is checked like any other.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const Rw = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');

const F = (a, b) => `$\\frac{${a}}{${b}}$`;
const DIGEST = {
  subject: 'maths', grade_band: '3-5', topic_as_taught: 'Compare unlike fractions',
  slos: [{ id: 'S1', statement: 'compare unlike fractions', taught_level: 'apply' }],
};
const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.002 } });

function proc(i, over = {}) {
  return {
    slo_id: 'S1', level: 'apply',
    question: `To compare ${F(2, 3)} and ${F(3, 5)} by cross multiplication, what is $2 \\times 5$? (${i})`,
    options: ['10', '6', '15'], correct_index: 0, explanation: 'Numerator times the other denominator.',
    selected_because: 'the cross multiplication in the worked example',
    distractor_misconceptions: { 1: 'multiplies inside one fraction', 2: 'multiplies the denominators' },
    option_feedback: { correct: 'Yes.', wrong: { 1: 'Use the other denominator.', 2: 'Not the two denominators.' } },
    ...over,
  };
}
const QUIZ = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => proc(i));
const READ_OFF = {
  replace: true, level: 'understand',
  question: 'What fraction of the bar in the picture is shaded?',
  options: [F(3, 5), F(2, 5), F(5, 3)], correct_index: 0,
  explanation: 'Three of the five equal parts are shaded.',
  selected_because: 'the bars drawn to compare fractions',
  distractor_misconceptions: { 1: 'counts the unshaded parts', 2: 'puts the parts on top' },
  option_feedback: { correct: 'Yes — three fifths.', wrong: { 1: 'That is the white part.', 2: 'The number of parts goes under the line.' } },
  figure: { type: 'fraction_bar', bars: [{ parts: 5, shaded: 3 }] }, figure_role: 'read_off',
};

beforeEach(() => mockCreate.mockReset());

describe('mergeAddedPictures — a replacement is a whole new read-off question', () => {
  test('replaces the question at its index, keeps the objective, and reports it as replaced', () => {
    const m = Rw.mergeAddedPictures(QUIZ, { pictures: [{ index: 3, ...READ_OFF }] }, { indices: [1, 3, 5], need: 3 });
    expect(m.added).toEqual([3]);
    expect(m.replaced).toEqual([3]);
    expect(m.questions[3]).toMatchObject({
      slo_id: 'S1', level: 'understand', question: READ_OFF.question, options: READ_OFF.options, correct_index: 0,
      figure: READ_OFF.figure, figure_role: 'read_off',
    });
    expect(m.questions[3].option_feedback).toEqual(READ_OFF.option_feedback);
  });

  test('can add to one question and replace another in the same reply', () => {
    const add = { index: 1, figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2 }, { parts: 5, shaded: 3 }] }, figure_role: 'model' };
    const m = Rw.mergeAddedPictures(QUIZ, { pictures: [add, { index: 5, ...READ_OFF }] }, { indices: [1, 3, 5], need: 3 });
    expect(m.added).toEqual([1, 5]);
    expect(m.replaced).toEqual([5]);
    expect(m.questions[1].question).toBe(QUIZ[1].question);
  });

  test.each([
    ['the easy first question', { index: 0, ...READ_OFF }, [0, 3]],
    ['a replacement with no picture', { index: 3, ...READ_OFF, figure: null }, [3]],
    ['a "model" replacement — a new question must be READ off its picture', { index: 3, ...READ_OFF, figure_role: 'model' }, [3]],
    ['a replacement with two options', { index: 3, ...READ_OFF, options: ['a', 'b'] }, [3]],
    ['a replacement with a key off its options', { index: 3, ...READ_OFF, correct_index: 5 }, [3]],
    ['a replacement with no stem', { index: 3, ...READ_OFF, question: '  ' }, [3]],
  ])('refuses %s', (_why, entry, indices) => {
    expect(Rw.mergeAddedPictures(QUIZ, { pictures: [entry] }, { indices, need: 2 })).toBeNull();
  });
});

describe('the repair is told it may replace, and when it must', () => {
  test('the prompt offers the replacement, names the procedure case, and lists the other stems', async () => {
    mockCreate.mockResolvedValueOnce(reply({ pictures: [{ index: 3, ...READ_OFF }] }));
    const out = await Rw.addPictures({ questions: QUIZ, digest: DIGEST, language: 'en', gradeBand: '3-5', need: 1 });
    expect(out).toMatchObject({ attempted: true, added: [3], replaced: [3] });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/REPLACE/);
    expect(prompt).toMatch(/procedure/i);
    expect(prompt).toMatch(/"replace":\s*true/);
    expect(prompt).toMatch(/Which bar shows/);
    expect(prompt).toMatch(/THE OTHER QUESTIONS/);
  });

  test('a replacement is held to the whole question contract, and told it is a NEW question', async () => {
    mockCreate.mockResolvedValueOnce(reply({ pictures: [] }));
    await Rw.addPictures({ questions: QUIZ, digest: DIGEST, language: 'ur', gradeBand: '3-5', need: 1 });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    // live: a "replacement" kept the method question and its key (20) under a new bar, and its
    // selected_because ran to 34 words — both refused, and the quiz stayed one picture short
    expect(prompt).toMatch(/A REPLACEMENT IS A NEW QUESTION/);
    expect(prompt).toMatch(/SELECTED BECAUSE[^\n]*at most 15 words/);
    expect(prompt).toMatch(/QUIZ LANGUAGE, AGAIN: Urdu[\s\S]*"selected_because" and "distractor_misconceptions"/);
    expect(prompt).toMatch(/THE CHILD HAS NO GENDER/);
  });

  test('the fraction recipes rule out two options of the same amount, and name the bars in words, never with an option letter', async () => {
    mockCreate.mockResolvedValueOnce(reply({ pictures: [] }));
    await Rw.addPictures({ questions: QUIZ, digest: DIGEST, language: 'ur', gradeBand: '3-5', need: 1 });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/never 2\/8 beside 1\/4/);
    expect(prompt).toMatch(/«پٹی P»/);
  });
});
