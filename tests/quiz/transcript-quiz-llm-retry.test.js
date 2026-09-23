'use strict';
/**
 * bd-mg9c7.159.17 — one malformed model reply must not fail a teacher's quiz.
 *
 * Sandbox E2E, 23 Sep 19:31 PKT: the LP digest for a lesson that had digested
 * cleanly an hour earlier came back as `{\n  "topic":` and nothing else.
 * completeJson threw BAD_JSON on that first reply, nothing retried, the quiz was
 * marked failed and the teacher was told the lesson plan could not be read.
 *
 * The real completeJson runs; only the model client (the network boundary) is
 * mocked.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: jest.fn((model) => ({
    client: { chat: { completions: { create: (...a) => mockCreate(...a) } } },
    model,
  })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');

const reply = (content, { finish = 'stop', cost = 0.001 } = {}) => ({
  choices: [{ message: { content }, finish_reason: finish }],
  usage: { cost },
});

beforeEach(() => mockCreate.mockReset());

describe('completeJson retries a bad reply once', () => {
  test('a reply cut off mid-object (the live one) is retried and the second reply is used', async () => {
    mockCreate
      .mockResolvedValueOnce(reply('{\n  "topic":'))
      .mockResolvedValueOnce(reply('{"topic":"Comparing fractions","slos":[]}'));
    const out = await completeJson({ prompt: 'p', label: 'lp_quiz.digest' });
    expect(out.json.topic).toBe('Comparing fractions');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('an empty reply is retried', async () => {
    mockCreate
      .mockResolvedValueOnce(reply(''))
      .mockResolvedValueOnce(reply('{"ok":true}'));
    const out = await completeJson({ prompt: 'p' });
    expect(out.json).toEqual({ ok: true });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('a truncated reply (finish_reason length, no content) is retried', async () => {
    mockCreate
      .mockResolvedValueOnce(reply('', { finish: 'length' }))
      .mockResolvedValueOnce(reply('{"ok":1}'));
    const out = await completeJson({ prompt: 'p' });
    expect(out.json).toEqual({ ok: 1 });
  });

  test('the cost of both attempts is reported', async () => {
    mockCreate
      .mockResolvedValueOnce(reply('not json', { cost: 0.002 }))
      .mockResolvedValueOnce(reply('{"ok":1}', { cost: 0.003 }));
    const out = await completeJson({ prompt: 'p' });
    expect(out.costUsd).toBeCloseTo(0.005, 6);
  });

  test('two bad replies still fail, with the second failure, after exactly two calls', async () => {
    mockCreate
      .mockResolvedValueOnce(reply('{"a":'))
      .mockResolvedValueOnce(reply('still not json'));
    await expect(completeJson({ prompt: 'p' })).rejects.toMatchObject({ code: 'BAD_JSON' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('a good first reply is one call', async () => {
    mockCreate.mockResolvedValueOnce(reply('{"ok":true}'));
    await completeJson({ prompt: 'p' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
