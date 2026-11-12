/**
 * bd-xabyzv — a large paper whose reply fails to parse is asked once more before BAD_JSON.
 */
jest.mock('../../shared/services/llm-client', () => ({ getClient: jest.fn(), getClientForModel: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { getClient } = require('../../shared/services/llm-client');
const { generateExam } = require('../../shared/services/assessment/assessment-generation.service');

const reply = (content, extra = {}) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
  ...extra,
});
const GOOD = JSON.stringify({ unseen: { short: { questions: [{ question: 'What is 2+2?', answer: '4', marks: 1 }] } } });
const BAD = '{ "sections": [ { "title": "A", "questions": [ { "question": "cut';
const ARGS = { grade: 5, subject: 'Maths', pageContent: 'Numbers', pageReference: 'p.1', questionCount: 1, questionTypes: [] };

function client(...contents) {
  const create = jest.fn();
  contents.forEach((c) => create.mockResolvedValueOnce(reply(c)));
  getClient.mockReturnValue({ chat: { completions: { create } } });
  return create;
}

describe('generateExam BAD_JSON retry', () => {
  it('malformed then valid: the paper succeeds on the second call', async () => {
    const create = client(BAD, GOOD);
    const out = await generateExam(ARGS);
    expect(create).toHaveBeenCalledTimes(2);
    expect(out.questionCount).toBe(1);
  });

  it('malformed twice: still BAD_JSON, and no third call', async () => {
    const create = client(BAD, BAD);
    await expect(generateExam(ARGS)).rejects.toMatchObject({ code: 'BAD_JSON' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('prose (a refusal) is not broken JSON: BAD_JSON at once, no second call', async () => {
    const create = client('I am unable to help with that.', GOOD);
    await expect(generateExam(ARGS)).rejects.toMatchObject({ code: 'BAD_JSON' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('valid first time: one call only', async () => {
    const create = client(GOOD);
    await generateExam(ARGS);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
