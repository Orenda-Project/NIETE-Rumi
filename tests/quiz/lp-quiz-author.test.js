'use strict';
/**
 * R8 lane D task 3.2 — the AUTHOR pass for a quiz with no transcript.
 *
 * An lp_v8 quiz is written from the lesson plan. Handed an empty transcript,
 * the unchanged prompt said "excerpts of the transcript" over nothing and asked
 * for a summary of "what you taught" — the model then invents classroom talk.
 * With `lessonPlan` the prompt reads the planned lesson and says "you planned".
 */
jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');

const DIGEST = { subject: 'maths', grade_band: '1-2', slos: [{ id: 'S1', taught_level: 'apply', evidence_quote: 'carry' }] };
const PLAN = 'WHAT THE CLASS WAS TO LEARN: add a 3-digit and a 2-digit number, carrying where a column fills up';

beforeEach(() => {
  jest.clearAllMocks();
  completeJson.mockResolvedValue({ json: { questions: [], lesson_summary: '' }, model: 'm', costUsd: 0, latencyMs: 1 });
});

test('with lessonPlan, the model reads the planned lesson — not transcript excerpts', async () => {
  await Author.author({ digest: DIGEST, transcript: null, language: 'en', lessonPlan: PLAN });
  const { prompt } = completeJson.mock.calls[0][0];
  expect(prompt).toContain(PLAN);
  expect(prompt).toContain('THE LESSON PLAN');
  expect(prompt).not.toContain('TRANSCRIPT EXCERPTS');
  expect(prompt).not.toContain('excerpts of the transcript');
});

test('with lessonPlan, the summary to the teacher says "you planned", never "what you taught"', async () => {
  await Author.author({ digest: DIGEST, transcript: null, language: 'en', lessonPlan: PLAN });
  const { prompt } = completeJson.mock.calls[0][0];
  expect(prompt).toMatch(/you planned/);
  expect(prompt).not.toMatch(/say what you taught/);
  expect(prompt).not.toMatch(/what you taught, with your own first example/);
});

test('without lessonPlan the transcript prompt is what it always was', async () => {
  await Author.author({ digest: DIGEST, transcript: 'x'.repeat(2000), language: 'en' });
  const { prompt } = completeJson.mock.calls[0][0];
  expect(prompt).toContain('TRANSCRIPT EXCERPTS');
  expect(prompt).toMatch(/say what you taught/);
  expect(prompt).not.toContain('THE LESSON PLAN (');
});
