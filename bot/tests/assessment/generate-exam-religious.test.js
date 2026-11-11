/**
 * bd-upejat.208 — the regular (non-pattern) paper path carries the religious rule and filter.
 */
jest.mock('../../shared/services/llm-client', () => ({ getClient: jest.fn(), getClientForModel: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { getClient } = require('../../shared/services/llm-client');
const { generateExam, buildSystemPrompt } = require('../../shared/services/assessment/assessment-generation.service');

const RELIGIOUS_Q = { question: 'حجۃ الوداع کے خطبے کی حدیث لکھیں۔', answer: 'جواب', marks: 1 };
const PLAIN_Q = { question: 'پاکستان کا دارالحکومت کون سا ہے؟', answer: 'اسلام آباد', marks: 1 };
const reply = (tree) => ({
  choices: [{ message: { content: JSON.stringify(tree) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});
const ARGS = { grade: 5, subject: 'sst', pageContent: 'متن', pageReference: 'p.1', questionCount: 2, questionTypes: [] };

describe('regular paper path: religious content', () => {
  it('the system prompt carries the religious rule (not for Islamiat itself)', () => {
    expect(buildSystemPrompt({ subject: 'sst' })).toMatch(/religious text/);
    expect(buildSystemPrompt({ subject: 'eng' })).toMatch(/religious text/);
    expect(buildSystemPrompt({ subject: 'islamiat' })).not.toMatch(/Never set an item that quotes, explains or evaluates a religious text/);
  });

  it('a generated question naming a religious text is filtered out of the paper', async () => {
    getClient.mockReturnValue({ chat: { completions: { create: jest.fn().mockResolvedValue(reply({ unseen: { short: { questions: [RELIGIOUS_Q, PLAIN_Q] } } })) } } });
    const out = await generateExam(ARGS);
    expect(out.questionCount).toBe(1);
    expect(JSON.stringify(out.examJson)).not.toContain('حدیث');
  });
});

describe('regular paper path: a failed book read does not fail the paper', () => {
  it('Urdu paper is still delivered when the held-pages read throws', async () => {
    jest.resetModules();
    jest.doMock('../../shared/services/llm-client', () => ({ getClient: jest.fn(), getClientForModel: jest.fn() }));
    jest.doMock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../shared/services/assessment/book-content.service', () => ({
      loadPageRangeContent: jest.fn().mockRejectedValue(new Error('storage down')),
    }));
    const llm = require('../../shared/services/llm-client');
    const Gen = require('../../shared/services/assessment/assessment-generation.service');
    llm.getClient.mockReturnValue({ chat: { completions: { create: jest.fn().mockResolvedValue(reply({ unseen: { short: { questions: [PLAIN_Q] } } })) } } });
    const out = await Gen.generateExam({ ...ARGS, subject: 'urdu' });
    expect(out.questionCount).toBe(1);
  });
});
