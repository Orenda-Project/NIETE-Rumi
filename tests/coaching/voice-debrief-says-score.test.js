/**
 * The voice debrief says the lesson's overall score as a number (bd-1r3k2h; the rule is bd-895yd's).
 *
 * coaching.feature COA58: "The coaching report and voice note give the lesson's scores as numbers … Assert
 * the numbers are present — never their values." The report does (68%, 19/28); the voice script never did,
 * because summarizeForVoiceDebrief's prompt structures the 90 seconds as greeting / strength / growth /
 * closing and says nothing about the score — mock runs 20261026-2335-par and 20261026-201716 both recorded
 * a debrief with no number in it ("Hi there! I wanted to share some thoughts from a recent classroom
 * visit…"). The prompt now carries a SCORE line, built from the analysis the projection keeps
 * (scores.overall_percentage / overall_marks / overall_max_marks), and forbids a band word in its place.
 *
 * Red-first: the prompt is captured at the LLM boundary (llm-client), so the assertion runs the real method.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const mockCreate = jest.fn(async () => ({ choices: [{ message: { content: 'script' } }], usage: {} }));
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }) }));

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');

const promptOf = () => mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0].messages[0].content;
const data = (scores) => ({ analysis: { framework: 'fico', scores, strengths: ['Real-world examples'] }, conversation: null, hasLessonPlan: false });

beforeEach(() => mockCreate.mockClear());

test('the prompt tells the coach to say the overall score as a number, and carries that number', async () => {
  await GPT5MiniService.summarizeForVoiceDebrief(data({ overall_percentage: 68, overall_marks: 19, overall_max_marks: 28 }), 'en');
  const p = promptOf();
  expect(p).toMatch(/SCORE/);
  expect(p).toMatch(/68%/);
  expect(p).toMatch(/19 (of|out of) 28/);
  expect(p).toMatch(/never a band word|not a band word/i);
});

test('an Urdu script gets the same number', async () => {
  await GPT5MiniService.summarizeForVoiceDebrief(data({ overall_percentage: 71, overall_marks: 20, overall_max_marks: 28 }), 'ur');
  expect(promptOf()).toMatch(/71%/);
});

test('with no overall score there is no made-up number', async () => {
  await GPT5MiniService.summarizeForVoiceDebrief(data({}), 'en');
  expect(promptOf()).not.toMatch(/\d+%/);
});
