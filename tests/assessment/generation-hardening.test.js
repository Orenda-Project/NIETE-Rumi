/**
 * The model call that writes a paper: a ceiling on its output, and one more try when it says nothing.
 *
 *   max_tokens 32000   The call set no ceiling, so a paper could run as long as the model's own
 *                      maximum, and a low provider balance reserved that maximum on every request.
 *                      The largest paper measured needed under 21,000 output tokens. A reply that
 *                      reaches the ceiling is a paper too long to write in one go: TRUNCATED, which
 *                      tells the teacher to ask for fewer questions, never BAD_JSON ("try again"),
 *                      which would only run the same failure twice.
 *
 *   empty reply        About one call in thirty at peak comes back empty: no content, no tokens
 *                      written, not cut off. That is a free no-op from the provider, not bad
 *                      output, and asking once more is what a teacher would otherwise do by hand.
 *                      Once: a second empty reply is BAD_JSON, as before.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const BASE = {
  grade: 5, subject: 'maths', pageContent: '=== Page 12 ===\nFractions', pageReference: '12',
  contentSource: 'unseen', questionCount: 2,
  questionTypes: [{ id: 'MCQs', count: 2, category: 'objective' }],
};
const PAPER = { unseen: { objective: { MCQs: [{ question: 'q1', marks: 1 }, { question: 'q2', marks: 1 }] } } };

const reply = (content, extra = {}) => ({
  choices: [{ message: { content }, finish_reason: extra.finish_reason ?? 'stop' }],
  usage: extra.usage ?? { prompt_tokens: 900, completion_tokens: 400, total_tokens: 1300 },
});
const EMPTY = () => reply('', { usage: { prompt_tokens: 900, completion_tokens: 0, total_tokens: 900 } });

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

describe('assessment-generation hardening: max_tokens', () => {
  test('max_tokens sent: 32000 on the call that writes the paper', async () => {
    mockCreate.mockResolvedValue(reply(JSON.stringify(PAPER)));
    await Gen.generateExam(BASE);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(32000);
  });

  test('everything else about the call is as it was', async () => {
    mockCreate.mockResolvedValue(reply(JSON.stringify(PAPER)));
    await Gen.generateExam(BASE);
    const params = mockCreate.mock.calls[0][0];
    expect(params.job).toBe('assessment.generate');
    expect(params.temperature).toBe(0.7);
    expect(params.response_format).toEqual({ type: 'json_object' });
    expect(Object.keys(params).sort()).toEqual(
      ['job', 'max_tokens', 'messages', 'model', 'response_format', 'temperature'].concat('fallbackModel' in params ? ['fallbackModel'] : []).sort());
  });

  test('a reply cut off at the ceiling is TRUNCATED, not BAD_JSON', async () => {
    mockCreate.mockResolvedValue(reply('{"unseen": {"objective": {"MCQs": [{"question": "q1", "ma',
      { finish_reason: 'length', usage: { prompt_tokens: 900, completion_tokens: 32000, total_tokens: 32900 } }));
    await expect(Gen.generateExam(BASE)).rejects.toMatchObject({ code: 'TRUNCATED' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('a reply that says length but still parses is used, not thrown away', async () => {
    mockCreate.mockResolvedValue(reply(JSON.stringify(PAPER), { finish_reason: 'length' }));
    const out = await Gen.generateExam(BASE);
    expect(out.questionCount).toBe(2);
  });
});

describe('assessment-generation hardening: an empty reply', () => {
  test('empty reply retried once, and the second answer is the paper', async () => {
    mockCreate.mockResolvedValueOnce(EMPTY()).mockResolvedValueOnce(reply(JSON.stringify(PAPER)));
    const out = await Gen.generateExam(BASE);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(out.questionCount).toBe(2);
    expect(out.tokenData.outputTokens).toBe(400);
    expect(mockLog).toHaveBeenCalledWith('[assessment] empty reply, retrying once', expect.any(Object));
    // The retry asks exactly the same question.
    expect(mockCreate.mock.calls[1][0]).toEqual(mockCreate.mock.calls[0][0]);
  });

  test('empty reply retried once then BAD_JSON', async () => {
    mockCreate.mockResolvedValue(EMPTY());
    await expect(Gen.generateExam(BASE)).rejects.toMatchObject({ code: 'BAD_JSON' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('a null content with no usage block counts as empty too', async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: null }, finish_reason: 'stop' }] })
      .mockResolvedValueOnce(reply(JSON.stringify(PAPER)));
    const out = await Gen.generateExam(BASE);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(out.questionCount).toBe(2);
  });

  test('an empty reply that was cut off is TRUNCATED at once, never retried', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: null }, finish_reason: 'length' }], usage: { completion_tokens: 32000 } });
    await expect(Gen.generateExam(BASE)).rejects.toMatchObject({ code: 'TRUNCATED' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('an empty reply that was billed for writing is not retried (it is not free)', async () => {
    mockCreate.mockResolvedValue(reply('', { usage: { prompt_tokens: 900, completion_tokens: 5000, total_tokens: 5900 } }));
    await expect(Gen.generateExam(BASE)).rejects.toMatchObject({ code: 'BAD_JSON' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('prose is not empty: it is BAD_JSON at once, as before', async () => {
    mockCreate.mockResolvedValue(reply('I am unable to help with that.', { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    await expect(Gen.generateExam(BASE)).rejects.toMatchObject({ code: 'BAD_JSON' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('the retry failing outright is MODEL_UNAVAILABLE, as any outage is', async () => {
    mockCreate.mockResolvedValueOnce(EMPTY()).mockRejectedValueOnce(new Error('502 upstream'));
    await expect(Gen.generateExam(BASE)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
