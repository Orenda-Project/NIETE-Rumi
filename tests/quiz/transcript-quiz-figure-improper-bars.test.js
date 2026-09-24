'use strict';
/**
 * An improper fraction is drawn as whole bars and a part bar, never as one bar
 * with more shaded than it has parts.
 *
 * Staging (a Proper/Improper Fraction lesson, Urdu): the picture repair was
 * refused twice with "FIGURE_EMPTY — shaded must be between 0 and parts" and
 * the quiz shipped two pictures of three. A replay of the same chapter showed
 * the spec the model writes: {"parts": 3, "shaded": 5} for 5/3, alone or as
 * bar Q of three. So:
 *   - a picture of ONE improper bar is redrawn as whole bars and a part bar
 *     (5/3 → 3/3 and 2/3), before any check reads it;
 *   - a bar that cannot be redrawn (it is one of several named bars) is refused
 *     with a reason that says how to draw it, which the repair's second round
 *     is shown;
 *   - the author and the repair are told the same thing up front.
 *
 * Through the real validator; only the loggers mocked.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const F = (a, b) => `$\\frac{${a}}{${b}}$`;
const DIGEST = { subject: 'maths', grade_band: '4', slos: [{ id: 'S1', statement: 'proper and improper fractions', taught_level: 'understand' }] };
const ctx = { language: 'en', subject: 'maths', digest: DIGEST, nExpected: 1 };
const q = (over) => ({
  slo_id: 'S1', level: 'understand', question: 'What fraction do the bars show?', options: [F(5, 3), F(2, 3), F(3, 5)], correct_index: 0,
  explanation: 'Five thirds are shaded.', selected_because: 'the bars in the lesson',
  distractor_misconceptions: { 1: 'counts the last bar', 2: 'swaps the numbers' },
  option_feedback: { correct: 'Yes.', wrong: { 1: 'Count every shaded third.', 2: 'The parts go under the line.' } },
  figure_role: 'read_off', ...over,
});
const figureErrors = (v) => v.errors.filter((e) => /^q0: FIGURE_/.test(e));

test('one bar of 5 shaded in 3 parts is drawn as a whole bar and two thirds', () => {
  const v = validate([q({ figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 5 }] } })], ctx);
  expect(v.questions[0].figure.bars).toEqual([{ parts: 3, shaded: 3 }, { parts: 3, shaded: 2 }]);
  expect(figureErrors(v)).toEqual([]);
});

test('11 shaded in 4 parts: two whole bars and three quarters', () => {
  const v = validate([q({ options: [F(11, 4), F(3, 4), F(4, 11)], figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 11 }] } })], ctx);
  expect(v.questions[0].figure.bars).toEqual([{ parts: 4, shaded: 4 }, { parts: 4, shaded: 4 }, { parts: 4, shaded: 3 }]);
  expect(figureErrors(v)).toEqual([]);
});

test('an improper bar among named bars is refused, with how to draw it', () => {
  const v = validate([q({
    question: `Which bar shows ${F(5, 3)}?`, options: ['P', 'Q', 'R'], correct_index: 1,
    distractor_misconceptions: { 0: 'x', 2: 'y' }, option_feedback: { correct: 'Yes.', wrong: { 0: 'No.', 2: 'No.' } },
    figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2, label: 'P' }, { parts: 3, shaded: 5, label: 'Q' }, { parts: 3, shaded: 3, label: 'R' }] },
  })], ctx);
  const e = figureErrors(v).join(' ');
  expect(e).toMatch(/FIGURE_EMPTY/);
  expect(e).toMatch(/whole bars and a part bar/);
});

describe('the author and the repair are told how an improper fraction is drawn', () => {
  test('the author prompt for a grade 1-5 maths lesson', () => {
    const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
    const p = Author.buildAuthorPrompt({ digest: { ...DIGEST, topic: 'Fractions' }, excerpts: '…', language: 'en', gradeBand: '4' });
    expect(p).toMatch(/never one bar with more shaded than parts/);
  });

  test('the picture repair prompt', async () => {
    const Rw = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pictures: [] }) }, finish_reason: 'stop' }], usage: {} });
    const item = (i) => ({ slo_id: 'S1', level: 'understand', question: `Is ${F(i + 4, 3)} proper or improper? (${i})`, options: ['proper', 'improper', 'a whole'], correct_index: 1 });
    await Rw.addPictures({ questions: [0, 1, 2, 3, 4, 5, 6, 7].map(item), digest: DIGEST, language: 'en', gradeBand: '4', need: 1 });
    expect(mockCreate.mock.calls[0][0].messages[0].content).toMatch(/never one bar with more shaded than parts/);
  });
});

test('a named set with an unnamed bar in it is refused: the child cannot tell which bars go together', () => {
  // Replay (grade 4 Urdu, after the prompt change): "which is an improper
  // fraction? P / Q / R" over bars P 2/4, Q 3/3, an UNNAMED 2/2 and R 1/2. The
  // model drew R's 3/2 as a whole bar and a half, named only the half, and so
  // made R read as 1/2 — while 3/2 is improper too, a second right answer the
  // blind solver could not see.
  const v = validate([q({
    question: 'Which of these is an improper fraction?', options: ['P', 'Q', 'R'], correct_index: 1,
    distractor_misconceptions: { 0: 'x', 2: 'y' }, option_feedback: { correct: 'Yes.', wrong: { 0: 'No.', 2: 'No.' } },
    figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 2, label: 'P' }, { parts: 3, shaded: 3, label: 'Q' }, { parts: 2, shaded: 2 }, { parts: 2, shaded: 1, label: 'R' }] },
  })], ctx);
  expect(figureErrors(v).join(' ')).toMatch(/FIGURE_PARTS_UNNAMED — bar 3 has no name/);
});
