'use strict';
/**
 * The blind solve runs on its OWN model, billed and failed over as its OWN job.
 *
 * A solver that shares the author's blind spots agrees with the author's
 * mistakes, so the solve does not run on TRANSCRIPT_QUIZ_MODEL: it runs on the
 * model registry's `quiz.keyVerify` (TRANSCRIPT_QUIZ_VERIFY_MODEL, default a
 * different and stronger model). Every other quiz pass is unchanged.
 *
 * The real verifyKeys and the real completeJson run; only the model client (the
 * network boundary) is mocked.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: jest.fn((model) => ({
    client: { chat: { completions: { create: (...a) => mockCreate(...a) } } },
    model,
  })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { getClientForModel } = require('../../bot/shared/services/llm-client');
const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const KV = require('../../bot/shared/services/quiz/transcript-quiz-key-verify.service');
const F = require('./helpers/key-verify-fixture');

const VARS = ['TRANSCRIPT_QUIZ_MODEL', 'TRANSCRIPT_QUIZ_VERIFY_MODEL'];
let saved;
beforeEach(() => {
  mockCreate.mockReset();
  getClientForModel.mockClear();
  saved = {};
  VARS.forEach((v) => { saved[v] = process.env[v]; delete process.env[v]; });
});
afterEach(() => VARS.forEach((v) => { if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v]; }));

/** A reply that agrees with every key, whatever order each item was shown in. */
function agreeing(questions) {
  return {
    choices: [{
      message: {
        content: JSON.stringify({
          answers: questions.map((q, i) => {
            const it = KV.itemFor(q, i, 'q-1');
            return { index: i, correct: [it.order.indexOf(q.correct_index)], unsure: false, note: '' };
          }),
        }),
      },
      finish_reason: 'stop',
    }],
    usage: { cost: 0.0042 },
  };
}

test('with nothing set, the solve runs on Claude Sonnet 5 as quiz.keyVerify — not on the author\'s model', async () => {
  process.env.TRANSCRIPT_QUIZ_MODEL = 'google/gemini-2.5-flash';
  mockCreate.mockResolvedValueOnce(agreeing(F.AUTHORED));

  const out = await KV.verifyKeys({ questions: F.AUTHORED, language: 'ur', grade: '3', subject: 'urdu', digest: F.DIGEST, quizId: 'q-1' });

  expect(getClientForModel).toHaveBeenCalledTimes(1);
  expect(getClientForModel).toHaveBeenCalledWith('anthropic/claude-sonnet-5', { job: 'quiz.keyVerify' });
  const params = mockCreate.mock.calls[0][0];
  expect(params.model).toBe('anthropic/claude-sonnet-5');
  expect(params.response_format).toEqual({ type: 'json_object' });
  expect(out.model).toBe('anthropic/claude-sonnet-5');
  expect(out.costUsd).toBe(0.0042);
  expect(out.verdicts.map((v) => v.verdict)).toEqual(Array(8).fill('agree'));
});

test('TRANSCRIPT_QUIZ_VERIFY_MODEL moves the solve, read per call', async () => {
  process.env.TRANSCRIPT_QUIZ_VERIFY_MODEL = 'openai/gpt-5.6-luna';
  mockCreate.mockResolvedValueOnce(agreeing(F.AUTHORED));
  await KV.verifyKeys({ questions: F.AUTHORED, language: 'ur', quizId: 'q-1' });
  expect(getClientForModel).toHaveBeenCalledWith('openai/gpt-5.6-luna', { job: 'quiz.keyVerify' });
});

test('every other quiz pass still runs on TRANSCRIPT_QUIZ_MODEL as quiz.transcript', async () => {
  process.env.TRANSCRIPT_QUIZ_MODEL = 'google/gemini-2.5-flash';
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: {} });
  await completeJson({ prompt: 'p', label: 'transcript_quiz.author' });
  expect(getClientForModel).toHaveBeenCalledWith('google/gemini-2.5-flash', { job: 'quiz.transcript' });
});
