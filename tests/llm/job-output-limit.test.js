/**
 * bd-lk7e3f.26 — a job can give its moved Claude call more room than the switch's usual allowance; the reflection
 * enhancement (coaching.enhance) gets 32,000 output tokens.
 *
 * A moved Claude call gets twice the call site's limit, but at most ALLOWANCE_CAP (4,096) more, so the enhancement's
 * 16,000 becomes 20,096. Its reply rewrites the whole analysis (median 11,355 output tokens on Haiku 5.5) after its
 * thinking, and on Haiku 5.5 21 of its first 707 calls (22-25 Nov) stopped at 20,096 and were handed back to
 * gpt-5-mini. Haiku 5.5 writes up to 128K output tokens; at about 220 a second, 32,000 finishes inside the direct lane's
 * 180 s request timeout. So the job's limit on a moved Claude call is raised to 32,000: only raised (never lowered),
 * only for a Claude model answering a moved call, never above the switch's ceiling. The job's own model, the
 * hand-back, every other job and the call's thinking and effort are exactly as before.
 *
 * Everything below the network is real: the client, the switch, the facade and the job's own call site. Only the
 * vendors, the settings table and the log sink are stubbed, at the boundary (as job-effort.test.js).
 */
const mockState = { or: [], an: [], events: [], rows: [], anImpl: null };

jest.mock('openai', () => function OpenAI() {
  return {
    chat: { completions: { create: async (params) => {
      mockState.or.push(params);
      return { choices: [{ index: 0, message: { role: 'assistant', content: '{"from":"openrouter"}' }, finish_reason: 'stop' }], usage: { cost: 0.001 } };
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
        content: [{ type: 'text', text: '{"executive_summary":"x"}' }], usage: { input_tokens: 400, output_tokens: 30 },
      };
    } },
  };
});

jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: mockState.rows, error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, data) => mockState.events.push({ name, data }),
  getCurrentCorrelationId: () => 'corr-1',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({
  mode: () => 'off', wrapChatCompletions: () => {},
}));

const OLD_ENV = { ...process.env };

function load(env = {}) {
  jest.resetModules();
  for (const k of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'LLM_PROVIDER', 'LLM_JOB_MODELS',
    'LLM_FALLBACK_OFF', 'LLM_DIRECT_FALLBACK_MODEL']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
    ...env,
  });
  // eslint-disable-next-line global-require
  return require('../../bot/shared/services/llm-client');
}

async function loadWithSettings(env, rows = []) {
  mockState.rows = rows;
  const mod = load(env);
  // eslint-disable-next-line global-require
  await require('../../bot/shared/config/model-settings').refresh();
  return mod;
}

const JOB = 'coaching.enhance';
const HAIKU55 = 'anthropic-direct/claude-haiku-5-5';
const msgs = [{ role: 'system', content: 'The framework.' }, { role: 'user', content: 'ORIGINAL ANALYSIS ...' }];
// The request the job's own call site makes (gpt5-mini.service.js enhanceAnalysisWithReflections): its own model, the
// job's name, a system and a user message, 16,000 tokens, JSON asked for.
const enhanceAsk = (extra = {}) => ({
  model: 'gpt-5-mini-2025-08-07', job: JOB, messages: msgs, max_completion_tokens: 16000,
  response_format: { type: 'json_object' }, ...extra,
});
const moveTo = (job, model) => ({ ANTHROPIC_API_KEY: 'grant-key', LLM_JOB_MODELS: JSON.stringify({ [job]: model }) });

beforeEach(() => {
  mockState.or = []; mockState.an = []; mockState.events = []; mockState.rows = []; mockState.anImpl = null;
});
afterEach(() => { process.env = { ...OLD_ENV }; });

// ---------------------------------------------------------------------------------------------
describe('the registry says which jobs get more room on Claude', () => {
  test('the enhancement gets 32,000, and every entry is a job the registry knows, at a limit the switch can send', () => {
    load();
    // eslint-disable-next-line global-require
    const { JOB_OUTPUT_LIMIT, JOBS } = require('../../bot/shared/config/model-registry');
    expect(JOB_OUTPUT_LIMIT[JOB]).toBe(32000);
    for (const [job, limit] of Object.entries(JOB_OUTPUT_LIMIT)) {
      expect(JOBS[job]).toBeDefined();
      expect(Number.isInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(64000);
    }
    expect(Object.isFrozen(JOB_OUTPUT_LIMIT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the enhancement on a Claude model gets 32,000 output tokens', () => {
  test('moved to Haiku 5.5: 32,000, thinking and effort left to the model as before', async () => {
    const { getClient } = await loadWithSettings(moveTo(JOB, HAIKU55));
    await getClient().chat.completions.create(enhanceAsk());
    expect(mockState.an).toHaveLength(1);
    expect(mockState.an[0].model).toBe('claude-haiku-5-5');
    expect(mockState.an[0].max_tokens).toBe(32000);
    expect(mockState.an[0].thinking).toBeUndefined();
    expect(mockState.an[0].output_config).toBeUndefined();
    expect(mockState.or).toHaveLength(0);
  });

  test('moved by the settings row (how production moves it), the same', async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key' },
      [{ key: 'llm_per_job', value: { [JOB]: HAIKU55 } }]);
    await getClient().chat.completions.create(enhanceAsk());
    expect(mockState.an[0].max_tokens).toBe(32000);
    expect(mockState.an[0].output_config).toBeUndefined();
  });

  test("through the job's own call site (enhanceAnalysisWithReflections), the same", async () => {
    await loadWithSettings(moveTo(JOB, HAIKU55));
    // eslint-disable-next-line global-require
    const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
    await GPT5MiniService.enhanceAnalysisWithReflections(
      { framework: 'fico', executive_summary: 'x' }, '[00:00] Teacher: Good morning.',
      { questions: [{ question_number: 1, question: 'What went well?', answer: 'The group work.' }] }, { duration: 600 }, 'u1', 's1',
    );
    expect(mockState.an).toHaveLength(1);
    expect(mockState.an[0].model).toBe('claude-haiku-5-5');
    expect(mockState.an[0].max_tokens).toBe(32000);
  });

  test('on another Claude model (Sonnet 5), the same 32,000', async () => {
    const { getClient } = await loadWithSettings(moveTo(JOB, 'anthropic-direct/claude-sonnet-5'));
    await getClient().chat.completions.create(enhanceAsk());
    expect(mockState.an[0].max_tokens).toBe(32000);
  });

  test('a call that asks for more than 32,000 after the allowance keeps its larger limit (never lowered)', async () => {
    const { getClient } = await loadWithSettings(moveTo(JOB, HAIKU55));
    await getClient().chat.completions.create(enhanceAsk({ max_completion_tokens: 40000 }));
    expect(mockState.an[0].max_tokens).toBe(44096);
  });
});

// ---------------------------------------------------------------------------------------------
describe('nothing changes anywhere else', () => {
  test('the enhancement not moved, on its own model through OpenRouter: the request is the call site\'s, untouched', async () => {
    const { getClient } = await loadWithSettings({});
    await getClient().chat.completions.create(enhanceAsk());
    expect(mockState.an).toHaveLength(0);
    expect(mockState.or).toHaveLength(1);
    expect(mockState.or[0].model).toBe('openai/gpt-5-mini-2025-08-07');   // the client's own OpenRouter spelling, as today
    expect(mockState.or[0].max_completion_tokens).toBe(16000);
    expect(mockState.or[0].max_tokens).toBeUndefined();
  });

  test('another job moved to Haiku 5.5 at the same 16,000: the usual 20,096, as before', async () => {
    const { getClient } = await loadWithSettings(moveTo('coaching.pedagogy', HAIKU55));
    await getClient().chat.completions.create(enhanceAsk({ job: 'coaching.pedagogy' }));
    expect(mockState.an[0].max_tokens).toBe(20096);
  });

  test("a reply cut off on Claude is handed back to the job's own model as the call site wrote it (16,000)", async () => {
    mockState.anImpl = (req) => ({
      id: 'msg_cut', model: req.model, stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"executive_summary":"the class' }], usage: { input_tokens: 400, output_tokens: 32000 },
    });
    const { getClient } = await loadWithSettings(moveTo(JOB, HAIKU55));
    await getClient().chat.completions.create(enhanceAsk());
    expect(mockState.an).toHaveLength(1);
    expect(mockState.an[0].max_tokens).toBe(32000);
    expect(mockState.or).toHaveLength(1);
    expect(mockState.or[0].model).toBe('openai/gpt-5-mini-2025-08-07');
    expect(mockState.or[0].max_completion_tokens).toBe(16000);
    expect(mockState.or[0].max_tokens).toBeUndefined();
    const back = mockState.events.find((e) => e.name === 'llm.job_override_fallback');
    expect(back && back.data.kind).toBe('cut_off');
  });

  test("the switch's exported limit helper keeps its answers (appliedOutputLimit, which takes no job)", () => {
    const { appliedOutputLimit } = load();
    expect(appliedOutputLimit(HAIKU55, 16000)).toBe(20096);
    expect(appliedOutputLimit(HAIKU55, 16000, false)).toBe(16000);
    expect(appliedOutputLimit('openai/gpt-5-mini', 16000)).toBe(16000);
  });
});
