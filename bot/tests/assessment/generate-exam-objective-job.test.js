/**
 * bd-rzjnjp.6 — generateExam sends an objective or maths G1-5 paper on its own job
 * (assessment.generate.objective) when ASSESSMENT_GEN_MODEL_OBJECTIVE is set; topic papers stay.
 */
jest.mock('../../shared/services/llm-client', () => ({ getClient: jest.fn(), getClientForModel: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
// The diagram registry loads openchemlib, which Jest on Node 25 cannot parse; no molecule is drawn here.
jest.mock('openchemlib', () => ({}));

const FLASH = 'google/gemini-3.8-flash';
const reply = () => ({
  choices: [{ message: { content: JSON.stringify({ unseen: { short: { questions: [{ question: 'What is 2 + 3?', answer: '5', marks: 1 }] } } }) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});
const MCQ = [{ id: 'mcq', category: 'objective', count: 2 }];
const BASE = { grade: 3, subject: 'english', pageContent: 'text', pageReference: 'p.1', questionCount: 2, questionTypes: MCQ };

async function sent(args, env) {
  jest.resetModules();
  const saved = process.env.ASSESSMENT_GEN_MODEL_OBJECTIVE;
  if (env) process.env.ASSESSMENT_GEN_MODEL_OBJECTIVE = env; else delete process.env.ASSESSMENT_GEN_MODEL_OBJECTIVE;
  try {
    const llm = require('../../shared/services/llm-client');
    const create = jest.fn().mockResolvedValue(reply());
    llm.getClient.mockReturnValue({ chat: { completions: { create } } });
    await require('../../shared/services/assessment/assessment-generation.service').generateExam(args);
    const { model, job, fallbackModel } = create.mock.calls[0][0];
    return { model, job, fallbackModel };
  } finally {
    if (saved === undefined) delete process.env.ASSESSMENT_GEN_MODEL_OBJECTIVE; else process.env.ASSESSMENT_GEN_MODEL_OBJECTIVE = saved;
  }
}

describe('generateExam: objective writer job', () => {
  it('an all-objective G3 paper runs on the objective job with Flash, own model behind it', async () => {
    const r = await sent(BASE, FLASH);
    expect(r.job).toBe('assessment.generate.objective');
    expect(r.model).toBe(FLASH);
    expect(r.fallbackModel).toBeTruthy();
    expect(r.fallbackModel).not.toBe(FLASH);
  });

  it('a G2 maths mixed paper moves too', async () => {
    const r = await sent({ ...BASE, grade: 2, subject: 'maths', questionTypes: [{ id: 'short', category: 'subjective', count: 2 }] }, FLASH);
    expect(r).toMatchObject({ job: 'assessment.generate.objective', model: FLASH });
  });

  it('a topic paper (slos given) stays on the plain job', async () => {
    const r = await sent({ ...BASE, slos: ['E3.1'] }, FLASH);
    expect(r.job).toBe('assessment.generate');
    expect(r.model).not.toBe(FLASH);
  });

  it('with no env var nothing moves', async () => {
    const r = await sent(BASE, null);
    expect(r.job).toBe('assessment.generate');
  });
});
