'use strict';
/**
 * A grade 1-5 maths author is told, in a way it can act on, to draw on
 * ATTEMPT 1 — and to write fractions stacked.
 *
 * Live: a grade 4 fractions lesson (comparing unlike fractions) came back with
 * NO picture on attempt 1, twice. The prompt read four ways at once: "write at
 * least three picture questions" at the top of a ~230-line picture section,
 * then "if the question can be answered without looking at the picture, there
 * is no figure", then "pick the 4 questions the picture genuinely earns and
 * write the rest as text", then "earn the figure". A lesson taught as a METHOD
 * (cross multiplication) has no question of the first kind until someone says
 * what one looks like, so the model wrote eight method questions and, obeying
 * the later lines, no picture. The FIGURE_REQUIRED retry then asked for "one or
 * two". So the maths prompt now says: plan the pictures first; here are the
 * read-off questions a fractions / place-value / counting lesson has; a step of
 * a procedure is a text question — and says it again at the end. And every
 * maths prompt asks for `$\frac{2}{3}$`, never `$2/3$` (which typesets flat).
 *
 * Asserted on the prompt the model is actually sent, and ABSENT where it does
 * not apply.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const Contract = require('../../bot/shared/services/quiz/transcript-quiz-contract');
const Generate = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const digest = (subject, band) => ({
  subject, grade_band: band, topic: 'Comparing unlike fractions',
  slos: [{ id: 'S1', statement: 'compare two fractions with different denominators', taught_level: 'apply' }],
});
const prompt = (subject, band, extra = {}) => Author.buildAuthorPrompt({
  digest: digest(subject, band), excerpts: '…', language: 'en', gradeBand: band, lessonPlan: 'THE PLAN', ...extra,
});

describe('fractions are written stacked', () => {
  test('the maths notation rule names the flat form and forbids it', () => {
    expect(Contract.MATH_NOTATION_RULE).toMatch(/never \$2\/3\$/);
    expect(Contract.MATH_NOTATION_RULE).toMatch(/stacked/);
  });

  test('every author prompt carries it', () => {
    expect(prompt('maths', '4')).toMatch(/never \$2\/3\$/);
    expect(prompt('science', '9')).toMatch(/never \$2\/3\$/);
  });
});

describe('grade 1-5 maths: plan the pictures first, and know what a picture question is', () => {
  const p = prompt('maths', '4');

  test('asks for the pictures to be planned BEFORE any question is written', () => {
    expect(p).toMatch(/PLAN THE PICTURES FIRST/);
  });

  test('names the read-off questions a fractions, place-value and counting lesson has', () => {
    expect(p).toMatch(/What fraction of the bar is shaded\?/);
    expect(p).toMatch(/Which bar shows/);
    expect(p).toMatch(/What number do the sticks show\?/);
    expect(p).toMatch(/How many counters/);
  });

  test('rules out two options of the same amount under a bar, and letters the bars in words', () => {
    expect(p).toMatch(/never 2\/8 beside 1\/4/);
    expect(p).toMatch(/«پٹی A»/);
  });

  test('says a step of a procedure is a text question, and draws the idea underneath it instead', () => {
    expect(p).toMatch(/step of a procedure/i);
    expect(p).toMatch(/cross product/i);
  });

  test('no line tells it to write the rest as text after four, or to stop at one or two', () => {
    expect(p).not.toMatch(/Pick the 4 questions the picture genuinely earns and write the rest as text/);
    expect(p).toMatch(/no fewer than three/i);
  });

  test('says it again at the END, after the rules and before the JSON', () => {
    const again = p.lastIndexOf('PICTURES, AGAIN');
    expect(again).toBeGreaterThan(p.indexOf('ALLOWED TYPES'));
    expect(again).toBeLessThan(p.indexOf('Return ONLY this JSON object'));
  });

  test('the prompt the model is sent on attempt 1 carries all of it', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ questions: [], lesson_summary: '' }) }, finish_reason: 'stop' }], usage: {} });
    await Author.author({ digest: digest('maths', '4'), transcript: null, language: 'ur', gradeBand: '4', lessonPlan: 'THE PLAN' });
    const sent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(sent).toMatch(/PLAN THE PICTURES FIRST/);
    expect(sent).toMatch(/PICTURES, AGAIN/);
  });
});

describe('none of it where it does not apply', () => {
  test.each([['english', '1-2'], ['science', '4'], ['maths', '6-8']])('%s grade %s', (subject, band) => {
    const other = prompt(subject, band);
    expect(other).not.toMatch(/PLAN THE PICTURES FIRST/);
    expect(other).not.toMatch(/PICTURES, AGAIN/);
    expect(other).not.toMatch(/What number do the sticks show\?/);
  });

  test('a grade 1-5 language lesson keeps the half rule as it was', () => {
    expect(prompt('english', '1-2')).toMatch(/Pick the 4 questions the picture genuinely earns and write the rest as text/);
  });
});

describe('FIGURE_REQUIRED asks a grade 1-5 maths retry for three, and says what they are', () => {
  const noFig = [{ question: 'a' }, { question: 'b' }];
  test('maths: at least three, read off a picture', () => {
    const msg = Generate.figureRequiredError({ questions: noFig, subject: 'maths', gradeBand: '4', attempt: 1, maxAttempts: 3 });
    expect(msg).toMatch(/FIGURE_REQUIRED/);
    expect(msg).toMatch(/at least three/);
    expect(msg).toMatch(/What fraction of the bar is shaded/);
    expect(msg).not.toMatch(/one or two/);
  });

  test('a language lesson keeps its own wording', () => {
    const msg = Generate.figureRequiredError({ questions: noFig, subject: 'english', gradeBand: '1-2', attempt: 1, maxAttempts: 3 });
    expect(msg).toMatch(/the word they sounded out/);
  });
});
