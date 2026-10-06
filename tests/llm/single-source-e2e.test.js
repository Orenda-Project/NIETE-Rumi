/**
 * bd-gr4fy.8 — the single source, end to end, through real call sites.
 *
 * The guard (single-source-guard.test.js) proves no in-scope call site writes its own model and
 * that each asks the registry for the job it labels. This proves the three things that buys, on
 * the wire, through two real call sites in two different files:
 *
 *   1. with nothing set, the request carries the registry's model for the job;
 *   2. the settings row moves the job with no deploy, with the registry's model behind it;
 *   3. the kill switch puts every job back on the registry's model.
 *
 * Only the vendors and the settings table are stubbed, at the boundary.
 */
const mockState = { or: [], events: [], rows: [], orImpl: null };

jest.mock('openai', () => function OpenAI() {
  return {
    chat: { completions: { create: async (params) => {
      mockState.or.push(params);
      if (mockState.orImpl) return mockState.orImpl(params);
      return { choices: [{ index: 0, message: { role: 'assistant', content: 'ur' }, finish_reason: 'stop' }], usage: { cost: 0.0001 } };
    } } },
  };
});
jest.mock('@anthropic-ai/sdk', () => function Anthropic() {
  return { messages: { create: async () => { throw new Error('not used here'); } } };
});
jest.mock('../../bot/shared/utils/model-cost', () => ({ recordModelCost: () => {} }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: mockState.rows, error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, data) => mockState.events.push({ name, data }),
  getCurrentCorrelationId: () => 'corr-1',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {}, logWarn: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({
  mode: () => 'off', wrapChatCompletions: () => {},
}), { virtual: true });

const OLD_ENV = { ...process.env };
const TRANSCRIPT = 'آج ہم کسر پڑھیں گے۔ بچے، ایک روٹی کے دو برابر حصے کریں۔';

async function load(rows = []) {
  jest.resetModules();
  for (const k of ['LLM_JOB_MODELS', 'LLM_PROVIDER', 'ANTHROPIC_API_KEY']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
  });
  mockState.rows = rows;
  // eslint-disable-next-line global-require
  await require('../../bot/shared/config/model-settings').refresh();
  // eslint-disable-next-line global-require
  return {
    detector: require('../../bot/shared/services/language-detector.service'),
    coaching: require('../../bot/shared/services/gpt5-mini.service'),
    registry: require('../../bot/shared/config/model-registry'),
  };
}
const wire = (m) => (m.includes('/') ? m : `openai/${m}`);
const sent = () => mockState.or.map((p) => p.model);

beforeEach(() => { mockState.or = []; mockState.events = []; mockState.rows = []; mockState.orImpl = null; });
afterEach(() => { process.env = { ...OLD_ENV }; });

test('with nothing set, each real call site sends the registry model for its job', async () => {
  const { detector, coaching, registry } = await load();
  await detector.detectLanguageWithGPT(TRANSCRIPT);
  await coaching.inferLessonTopic(TRANSCRIPT);
  expect(sent()).toEqual([wire(registry.modelFor('lang.detect')), wire(registry.modelFor('coaching.inferTopic'))]);
});

test('the settings row moves each job with no deploy, with the registry model behind it', async () => {
  const { detector, coaching, registry } = await load([{ key: 'llm_per_job', value: {
    'lang.detect': 'anthropic/claude-haiku-4-5', 'coaching.inferTopic': 'anthropic/claude-haiku-4-5',
  } }]);
  mockState.orImpl = (p) => {
    if (p.model.includes('claude')) { const e = new Error('upstream exploded'); e.status = 500; throw e; }
    return { choices: [{ message: { content: 'ur' }, finish_reason: 'stop' }], usage: {} };
  };
  await detector.detectLanguageWithGPT(TRANSCRIPT);
  await coaching.inferLessonTopic(TRANSCRIPT);
  expect(sent()).toEqual([
    'anthropic/claude-haiku-4-5', wire(registry.modelFor('lang.detect')),
    'anthropic/claude-haiku-4-5', wire(registry.modelFor('coaching.inferTopic')),
  ]);
});

test('the kill switch puts every job back on the registry model', async () => {
  const { detector, coaching, registry } = await load([
    { key: 'llm_kill_switch', value: true },
    { key: 'llm_per_job', value: { 'lang.detect': 'anthropic/claude-haiku-4-5', 'coaching.inferTopic': 'anthropic/claude-haiku-4-5' } },
  ]);
  await detector.detectLanguageWithGPT(TRANSCRIPT);
  await coaching.inferLessonTopic(TRANSCRIPT);
  expect(sent()).toEqual([wire(registry.modelFor('lang.detect')), wire(registry.modelFor('coaching.inferTopic'))]);
});
