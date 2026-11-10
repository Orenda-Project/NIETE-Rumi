'use strict';
/**
 * The blind solve shows the SAME quiz the SAME way every time (bd-jfiqae.1).
 *
 * The solver sees each item's options in a shuffled order, so an author's habit of
 * putting the right answer first cannot be read. That order was seeded on the quiz's
 * id, and a quiz id is a fresh UUID each time a quiz is generated. So the same lesson
 * produced the same questions in a different order on every run, the solve prompt
 * changed, and on the mock lane its cassette key changed with it: 25 recorded answers
 * for this call never replayed (NIETE-Rumi #4466, training: 15 misses before and after
 * recording). The order now depends on the item and its wording, and on which look it
 * is (the `again` re-solve still shows a different order), never on the quiz id.
 *
 * Mocked at the boundary only: the LLM client. itemFor, the shuffle and the prompt
 * builder run for real.
 */

jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const KV = require('../../bot/shared/services/quiz/transcript-quiz-key-verify.service');
const F = require('./helpers/key-verify-fixture');

function promptFor({ quizId, again = false }) {
  completeJson.mockClear();
  completeJson.mockResolvedValue({ json: { answers: [] }, model: 'm', costUsd: 0, latencyMs: 1 });
  return KV.verifyKeys({
    questions: F.AUTHORED, language: 'en', quizId, again, strictKey: false,
  }).then(() => {
    expect(completeJson).toHaveBeenCalledTimes(1);
    return JSON.stringify(completeJson.mock.calls[0]);
  });
}

describe('the blind solve does not depend on the quiz id', () => {
  test('two quizzes with the same questions get the same solve prompt', async () => {
    const a = await promptFor({ quizId: '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f' });
    const b = await promptFor({ quizId: 'a9e7d3c1-5b4f-4e2d-8c1a-7f6e5d4c3b2a' });
    expect(a).toBe(b);
  });

  test('the second look still shows the options in a different order, and that order is stable too', async () => {
    const first = await promptFor({ quizId: 'q-one' });
    const againA = await promptFor({ quizId: 'q-one', again: true });
    const againB = await promptFor({ quizId: 'q-two', again: true });
    expect(againA).toBe(againB);
    expect(againA).not.toBe(first);
  });
});
