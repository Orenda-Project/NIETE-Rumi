/**
 * bd-5jmnfj.38.40 — a caller can ask which model a job will go to first, so it can set that model's
 * thinking. The G6+ assessment writer is moved to Claude by `LLM_JOB_MODELS` on sandbox, while its call
 * site names Gemini: reading the settings row alone missed the move and left full thinking on.
 */
const mockState = {
  or: [], an: [], recorded: [], events: [], rows: [], orImpl: null, anImpl: null,
};

jest.mock('openai', () => function OpenAI() {
  return {
    chat: { completions: { create: async (params) => {
      mockState.or.push(params);
      if (mockState.orImpl) return mockState.orImpl(params);
      return { choices: [{ index: 0, message: { role: 'assistant', content: 'from openrouter' }, finish_reason: 'stop' }], usage: { cost: 0.001 } };
    } } },
  };
});

jest.mock('@anthropic-ai/sdk', () => function Anthropic() {
  return {
    messages: { create: async (req) => {
      mockState.an.push(req);
      if (mockState.anImpl) return mockState.anImpl(req);
      return {
        id: 'msg_1', model: req.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'from claude' }], usage: { input_tokens: 5, output_tokens: 3 },
      };
    } },
  };
});

jest.mock('../../bot/shared/utils/model-cost', () => ({
  recordModelCost: (model, response, startedAt, extra) => mockState.recorded.push({ model, extra: extra || {} }),
}));
// The settings table is stubbed at the database boundary, so the real model-settings module
// parses the rows exactly as it does in production.
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: mockState.rows, error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, data) => mockState.events.push({ name, data }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({
  mode: () => 'off', wrapChatCompletions: () => {},
}), { virtual: true });

const OLD_ENV = { ...process.env };

function load(env = {}) {
  jest.resetModules();
  for (const k of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER', 'LLM_JOB_MODELS',
    'LLM_FALLBACK_OFF', 'LLM_DIRECT_FALLBACK_MODEL']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
    ...env,
  });
  // eslint-disable-next-line global-require
  return require('../../bot/shared/services/llm-client');
}

/**
 * Load with app_settings rows already read, as a running process has them after its first second.
 * Every case that moves a job uses this: an override waits until the settings (and so the kill
 * switch) have been read once (bd-gr4fy.6), and that wait has its own case in
 * job-override-hardening.test.js.
 */
async function loadWithSettings(env, rows) {
  mockState.rows = rows;
  const mod = load(env);
  // eslint-disable-next-line global-require
  await require('../../bot/shared/config/model-settings').refresh();
  return mod;
}

afterEach(() => { process.env = { ...OLD_ENV }; });

describe('modelInForce(job, siteModel)', () => {
  test('names the model the env map moves a job to', async () => {
    const { modelInForce } = await loadWithSettings({ LLM_JOB_MODELS: JSON.stringify({ 'assessment.generate': 'anthropic/claude-sonnet-5' }) });
    expect(modelInForce('assessment.generate', 'google/gemini-3.1-pro-preview')).toBe('anthropic/claude-sonnet-5');
  });

  test('the settings row outranks the env map', async () => {
    const { modelInForce } = await loadWithSettings(
      { LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic/claude-haiku-4-5' }) },
      [{ key: 'llm_per_job', value: { 'chat.intent': 'anthropic/claude-sonnet-5' } }],
    );
    expect(modelInForce('chat.intent', 'openai/gpt-4.1-mini')).toBe('anthropic/claude-sonnet-5');
  });

  test('with nothing written, or the kill switch on, it is the call site\'s own model', async () => {
    let { modelInForce } = await loadWithSettings();
    expect(modelInForce('chat.intent', 'openai/gpt-4.1-mini')).toBe('openai/gpt-4.1-mini');
    ({ modelInForce } = await loadWithSettings(
      { LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic/claude-haiku-4-5' }) },
      [{ key: 'llm_kill_switch', value: true }],
    ));
    expect(modelInForce('chat.intent', 'openai/gpt-4.1-mini')).toBe('openai/gpt-4.1-mini');
  });

  test('sends nothing', async () => {
    const { modelInForce } = await loadWithSettings({ LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic/claude-haiku-4-5' }) });
    modelInForce('chat.intent', 'openai/gpt-4.1-mini');
    expect(mockState.or).toHaveLength(0);
    expect(mockState.an).toHaveLength(0);
  });
});
