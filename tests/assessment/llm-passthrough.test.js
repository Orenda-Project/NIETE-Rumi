/**
 * The output ceiling and a per-call timeout reach the SDK through the shared model client.
 *
 * The client wraps every call: it strips its own labels (`job`, `fallbackModel`) before the request
 * goes out and may route the job to another model. A paper's `max_tokens` is only real if it
 * survives that wrapping, so this drives the REAL generateExam through the REAL client and stops at
 * the network boundary (the SDK constructor, mocked), where it reads what would have been sent.
 *
 * A per-call timeout is the SDK's REQUEST OPTION (the second argument to create), not a body
 * field: a `timeout` written into the body would be sent to the provider as an unknown parameter.
 * The client forwards the options untouched, on the plain path and when a settings row moves the
 * job to another model.
 */

const mockState = { sent: [], rows: [] };

jest.mock('openai', () => function OpenAI() {
  return {
    chat: { completions: { create: async (params, options) => {
      mockState.sent.push({ params, options });
      return {
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, cost: 0.001 },
      };
    } } },
  };
});
jest.mock('@anthropic-ai/sdk', () => function Anthropic() { return { messages: { create: async () => { throw new Error('not used'); } } }; });
jest.mock('../../bot/shared/utils/model-cost', () => ({ recordModelCost: () => {} }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: mockState.rows, error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: () => {} }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }), { virtual: true });

const OLD_ENV = { ...process.env };

async function load(rows = []) {
  jest.resetModules();
  for (const k of ['ANTHROPIC_API_KEY', 'LLM_PROVIDER', 'LLM_JOB_MODELS', 'LLM_FALLBACK_OFF', 'ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_URDU']) delete process.env[k];
  Object.assign(process.env, { OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test' });
  mockState.rows = rows;
  // eslint-disable-next-line global-require
  await require('../../bot/shared/config/model-settings').refresh();
}

beforeEach(() => { mockState.sent = []; mockState.rows = []; });
afterEach(() => { process.env = { ...OLD_ENV }; });

const PAPER_ARGS = {
  grade: 5, subject: 'maths', pageContent: '=== Page 12 ===\nFractions', pageReference: '12',
  contentSource: 'unseen', questionCount: 1, questionTypes: [{ id: 'MCQs', count: 1, category: 'objective' }],
};

describe('a paper through the real client', () => {
  test('max_tokens 32000 reaches the SDK, and the client\'s own labels do not', async () => {
    await load();
    // eslint-disable-next-line global-require
    const { generateExam } = require('../../bot/shared/services/assessment/assessment-generation.service');
    await generateExam(PAPER_ARGS);
    expect(mockState.sent).toHaveLength(1);
    const { params } = mockState.sent[0];
    expect(params.max_tokens).toBe(32000);
    expect('job' in params).toBe(false);
    expect('fallbackModel' in params).toBe(false);
  });

  test('max_tokens still reaches the SDK when a settings row moves the job', async () => {
    await load([{ key: 'llm_per_job', value: { 'assessment.generate': 'openai/gpt-4.1' } }]);
    // eslint-disable-next-line global-require
    const { generateExam } = require('../../bot/shared/services/assessment/assessment-generation.service');
    await generateExam(PAPER_ARGS);
    const last = mockState.sent[mockState.sent.length - 1];
    expect(last.params.model).toBe('openai/gpt-4.1');
    expect(last.params.max_tokens).toBe(32000);
  });
});

describe('a per-call timeout', () => {
  const ask = { model: 'openai/gpt-4.1-mini', job: 'assessment.generate', max_tokens: 12000, messages: [{ role: 'user', content: 'x' }] };

  test('passes through as a request option on the plain path', async () => {
    await load();
    // eslint-disable-next-line global-require
    const { getClient } = require('../../bot/shared/services/llm-client');
    await getClient().chat.completions.create({ ...ask }, { timeout: 240000 });
    const { params, options } = mockState.sent[0];
    expect(options).toMatchObject({ timeout: 240000 });
    expect(params.max_tokens).toBe(12000);
    expect('timeout' in params).toBe(false);
  });

  // assessment.generate reads its settings AT THE CALL SITE: the site sends the moved model and
  // declares its own as `fallbackModel`, and the client tries the moved one with the own one behind.
  test('passes through when the settings moved the job (the moved model, own model behind)', async () => {
    await load([{ key: 'llm_per_job', value: { 'assessment.generate': 'openai/gpt-4.1' } }]);
    // eslint-disable-next-line global-require
    const { getClient } = require('../../bot/shared/services/llm-client');
    await getClient().chat.completions.create(
      { ...ask, model: 'openai/gpt-4.1', fallbackModel: 'openai/gpt-4.1-mini' }, { timeout: 240000 });
    const first = mockState.sent[0];
    expect(first.params.model).toBe('openai/gpt-4.1');
    expect(first.params.max_tokens).toBe(12000);
    expect(first.options).toMatchObject({ timeout: 240000 });
    expect('fallbackModel' in first.params).toBe(false);
  });
});
