'use strict';
/**
 * The prompts stop teaching the model to name parts A, B, C — the card's option
 * letters — and tell it to write a person's name in the quiz language.
 *
 * The validator renames a lettered part anyway (relabelLetterParts), but a
 * prompt that shows "points A, B, C" in its own worked example asks for the
 * fault on every picture. And in a remade Urdu quiz a child's name from the
 * English lesson stayed in Latin letters inside the Urdu sentences ("‏Hira کی
 * بوتل", the bar's name too): the Urdu style rule keeps TERMS in English
 * letters, and the model read the name as a term. A name is not a term.
 *
 * Asserted on the prompts the model is actually sent (llm-client mocked).
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const Rw = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');

const digest = (subject, band) => ({ subject, grade_band: band, topic: 'Lesson', slos: [{ id: 'S1', statement: 'the idea', taught_level: 'understand' }] });
const authorPrompt = (subject, band, language = 'ur') => Author.buildAuthorPrompt({ digest: digest(subject, band), excerpts: '…', language, gradeBand: band });
const LETTER_PART = /"label"\s*:\s*"[A-D]"|labelled "A"|points "A"|options \["A", "B", "C"\]/;

describe('no prompt names a part with an option letter', () => {
  test.each([['maths', '4'], ['maths', '8'], ['science', '9']])('the author prompt, %s grade %s', (subject, band) => {
    const p = authorPrompt(subject, band);
    expect(p).not.toMatch(LETTER_PART);
    expect(p).toMatch(/NAMING THE PARTS/);
    expect(p).toMatch(/never A, B, C or D/);
  });

  test('the add-pictures repair prompt', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pictures: [] }) }, finish_reason: 'stop' }], usage: {} });
    const q = (i) => ({ slo_id: 'S1', level: 'understand', question: `What is $${i} \\times 5$?`, options: [String(i * 5), String(i * 5 + 1), String(i + 5)], correct_index: 0 });
    await Rw.addPictures({ questions: [0, 1, 2, 3, 4, 5, 6, 7].map(q), digest: digest('maths', '4'), language: 'en', gradeBand: '4', need: 1 });
    const p = mockCreate.mock.calls[0][0].messages[0].content;
    expect(p).not.toMatch(LETTER_PART);
    expect(p).toMatch(/NAMING THE PARTS/);
  });
});

describe('a person is named in the quiz language', () => {
  test('the Urdu style rule says names are not terms, and shows one written in Urdu', () => {
    const p = authorPrompt('maths', '4', 'ur');
    expect(p).toMatch(/NAMES ARE NOT TERMS/);
    expect(p).toMatch(/Hira → حرا/);
  });

  test('the picture rules say a name in a label is written in the quiz language too', async () => {
    expect(authorPrompt('maths', '4', 'ur')).toMatch(/a person's name in a label is written in the quiz language/);
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ pictures: [] }) }, finish_reason: 'stop' }], usage: {} });
    const q = (i) => ({ slo_id: 'S1', level: 'understand', question: `What is $${i} \\times 5$?`, options: [String(i * 5), String(i * 5 + 1), String(i + 5)], correct_index: 0 });
    await Rw.addPictures({ questions: [0, 1, 2, 3, 4, 5, 6, 7].map(q), digest: digest('maths', '4'), language: 'ur', gradeBand: '4', need: 1 });
    expect(mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0].messages[0].content).toMatch(/a person's name in a label is written in the quiz language/);
  });
});
