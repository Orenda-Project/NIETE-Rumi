'use strict';
/**
 * The AUTHOR is told what a grade 1-5 maths quiz now aims for: at least three
 * picture questions of eight (never more than half), pictures that MODEL the
 * stem's numbers ("figure_role": "model"), and — on a quiz written from a
 * lesson plan — the manipulatives that lesson drew. Each is asserted on the
 * prompt the model is actually sent (author() through the real LLM wrapper,
 * `llm-client` mocked), and each is ABSENT where it does not apply.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');

const digest = (subject, band) => ({
  subject, grade_band: band, topic: 'Lesson',
  slos: [{ id: 'S1', statement: 'the idea', taught_level: 'understand' }],
});
const prompt = (subject, band, extra = {}) => Author.buildAuthorPrompt({
  digest: digest(subject, band), excerpts: '…', language: 'en', gradeBand: band, ...extra,
});
const DREW = 'WHAT THE LESSON DREW — the manipulatives this lesson put in front of the class.\n- counter → "picto":"counter" in count_objects';

describe('grade 1-5 maths: at least three pictures, and pictures that model the stem', () => {
  const p = prompt('maths', '1-2');

  test('asks for AT LEAST THREE picture questions of eight, and never more than four', () => {
    expect(p).toMatch(/AT LEAST THREE picture questions of the 8/);
    expect(p).toMatch(/never more than 4/);
  });

  test('offers figure_role "model" for the pictorial step the lesson used', () => {
    expect(p).toMatch(/"figure_role": "model"/);
    expect(p).toMatch(/which is larger/i);
  });

  test('does not offer the model role, or the density line, where they do not apply', () => {
    ['english', 'science'].forEach((s) => {
      const other = prompt(s, '1-2');
      expect(other).not.toMatch(/AT LEAST THREE picture questions/);
      expect(other).not.toMatch(/"figure_role": "model"/);
    });
    const g7 = prompt('maths', '6-8');
    expect(g7).not.toMatch(/"figure_role": "model"/);
    expect(g7).toMatch(/EARN THE FIGURE/);
  });
});

describe('WHAT THE LESSON DREW rides into the prompt when there is one', () => {
  test('buildAuthorPrompt carries the block after the picture rules', () => {
    const p = prompt('maths', '1-2', { lessonDrew: DREW });
    expect(p).toContain(DREW);
    expect(p.indexOf(DREW)).toBeGreaterThan(p.indexOf('PICTURE QUESTIONS.'));
    expect(prompt('maths', '1-2')).not.toMatch(/WHAT THE LESSON DREW/);
  });

  test('author() sends it to the model', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ questions: [], lesson_summary: '' }) }, finish_reason: 'stop' }], usage: {} });
    await Author.author({ digest: digest('maths', '1-2'), transcript: null, language: 'en', gradeBand: '1-2', lessonPlan: 'THE PLAN', lessonDrew: DREW });
    expect(mockCreate.mock.calls[0][0].messages[0].content).toContain(DREW);
  });
});
