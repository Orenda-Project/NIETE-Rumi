/**
 * bd-rvbv9o.1 — generateExam lowers the writer's inflated Bloom's tags before the paper is
 * stored, and keeps honest ones. Mocked at the network boundary (the LLM client) only.
 * Grades 1-2 are left exactly as they were (Amena, 6 Nov): those papers are FDE's own model
 * assessments, so neither the cap nor the prompt note touches them.
 */
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

const drillPaper = () => ({
    unseen: {
      objective: { MCQs: [{ question: '250 - 125 = ?', options: ['a) 115', 'b) 125'], answer: 'b', marks: 1, blooms: 'Apply' }] },
      subjective: { 'Word Problems': [{ question: 'Ammi bought groceries worth Rs. 632. She gave the shopkeeper Rs. 700. How much money did she get back?', answer: 'Rs. 68', marks: 5, blooms: 'Apply' }] },
    },
});
const runDrill = (grade) => {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(drillPaper()) } }], usage: {} });
  return Gen.generateExam({
    grade, subject: 'Maths', pageContent: 'x', pageReference: '1', contentSource: 'unseen',
    questionTypes: [{ id: 'MCQs', count: 1, category: 'objective' }, { id: 'Word Problems', count: 1, category: 'subjective' }],
    includeAnswerKey: true,
  });
};

test('a bare sum tagged Apply is stored as Understand; a word problem keeps Apply', async () => {
  const out = await runDrill(3);
  expect(out.examJson.unseen.objective.MCQs[0].blooms).toBe('Understand');
  expect(out.examJson.unseen.subjective['Word Problems'][0].blooms).toBe('Apply');
  const logged = mockLog.mock.calls.find(([msg]) => /bloom/i.test(msg));
  expect(logged?.[1]?.moved).toEqual([{ question: '250 - 125 = ?', from: 'Apply', to: 'Understand' }]);
});

describe('the writer is told drill is not Apply (non-board papers only)', () => {
  const sysFor = async (subject) => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ unseen: { objective: { MCQs: [{ question: 'q', options: ['a) 1'], answer: 'a', marks: 1, blooms: 'Remember' }] } } }) } }], usage: {} });
    await Gen.generateExam({
      grade: 4, subject, pageContent: 'x', pageReference: '1', contentSource: 'unseen',
      questionTypes: [{ id: 'MCQs', count: 1, category: 'objective' }], includeAnswerKey: true,
    });
    return mockCreate.mock.calls[0][0].messages[0].content;
  };
  test.each(['Maths', 'Eng', 'Urdu', 'Science'])('%s: the model call carries the rule', async (subject) => {
    const sys = await sysFor(subject);
    expect(sys).toMatch(/Not Apply: a bare sum, a drill/);
    expect(sys).toContain('This overrides any example above');
  });
  test('the shared builder the board path uses is not changed', () => {
    expect(Gen.buildSystemPrompt({ subject: 'Maths', includeAnswerKey: true })).not.toMatch(/Not Apply/);
  });
});

describe('grades 1-2 are FDE model assessments: left exactly as written', () => {
  test.each([1, 2, '1', '2'])('grade %p: tags unchanged, nothing logged, no note in the prompt', async (grade) => {
    const out = await runDrill(grade);
    expect(out.examJson.unseen.objective.MCQs[0].blooms).toBe('Apply');
    expect(mockLog.mock.calls.find(([msg]) => /bloom/i.test(msg))).toBeUndefined();
    const sys = mockCreate.mock.calls[0][0].messages[0].content;
    expect(sys).toBe(Gen.buildSystemPrompt({ subject: 'Maths', includeAnswerKey: true }));
  });
  test.each([3, '5'])('grade %p still gets the cap', async (grade) => {
    const out = await runDrill(grade);
    expect(out.examJson.unseen.objective.MCQs[0].blooms).toBe('Understand');
  });
});
