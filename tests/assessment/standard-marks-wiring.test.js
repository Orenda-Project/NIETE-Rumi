/**
 * bd-ipoxhx.7 — AG row 21: the standard marks are applied to every generated regular paper,
 * before the marks budget is measured, and the prompt asks for them up front.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
const BASE = { grade: 3, subject: 'Science', pageContent: '=== Page 4 ===\nPlants need water.',
  pageReference: '4-6', contentSource: 'unseen' };
const T = (id, count, category = 'objective') => ({ id, count, category });
const q = (n, marks) => ({ question: `q${n}`, marks });

beforeEach(() => mockCreate.mockReset());

describe('generateExam writes standard marks', () => {
  test('an MCQ the model marked 5 comes back worth 1, a long question stays within 5-10', async () => {
    mockCreate.mockResolvedValue(reply({ unseen: {
      objective: { MCQs: [q(1, 5), q(2, 6)] },
      subjective: { 'Long Question': [q(3, 20)] },
    } }));
    const out = await Gen.generateExam({ ...BASE, questionCount: 3,
      questionTypes: [T('MCQs', 2), T('Long Question', 1, 'subjective')] });
    expect(out.examJson.unseen.objective.MCQs.map((x) => x.marks)).toEqual([1, 1]);
    expect(out.examJson.unseen.subjective['Long Question'][0].marks).toBe(10);
  });

  test('the budget is measured on the standard marks, so nothing is dropped for marks the model inflated', async () => {
    mockCreate.mockResolvedValue(reply({ unseen: { objective: { MCQs: [q(1, 5), q(2, 5), q(3, 5), q(4, 5)] } } }));
    const out = await Gen.generateExam({ ...BASE, questionCount: 4, questionTypes: [T('MCQs', 4)], totalMarks: 10 });
    expect(out.marksRemoved).toBe(0);
    expect(out.questionCount).toBe(4);
  });

  test('the prompt states the standard marks', () => {
    const prompt = Gen.buildUserPrompt({ ...BASE, questionCount: 2, questionTypes: [T('MCQs', 2)] });
    expect(String(prompt)).toMatch(/1 mark each/);
    expect(String(prompt)).toMatch(/2.3 marks/);
    expect(String(prompt)).toMatch(/5.10 marks/);
  });
});
