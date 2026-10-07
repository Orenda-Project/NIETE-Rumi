/**
 * bd-gr4fy.9 — the override's config event names the process it came from.
 *
 * On sandbox (6 Oct, 17:20Z) two sqs-worker processes reported an EMPTY override map while every
 * other process reported the full one, and their quiz calls stayed on the old model. The events
 * carried no host, deployment or replica, so which machine they ran on could not be read from the
 * logs. `llm.job_override_config` is emitted once per process (and per change), so naming the
 * process there is enough to trace the next one.
 */
const mockState = { events: [], rows: [] };

jest.mock('openai', () => function OpenAI() {
  return { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }) } } };
});
jest.mock('@anthropic-ai/sdk', () => function Anthropic() { return { messages: { create: async () => ({}) } }; });
jest.mock('../../bot/shared/utils/model-cost', () => ({ recordModelCost: () => {} }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: mockState.rows, error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, data) => mockState.events.push({ name, data }),
  getCurrentCorrelationId: () => 'corr-1',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }), { virtual: true });

const OLD_ENV = { ...process.env };
const RAILWAY = ['RAILWAY_SERVICE_NAME', 'RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_REPLICA_ID'];

async function callOnce(env) {
  jest.resetModules();
  for (const k of [...RAILWAY, 'LLM_JOB_MODELS']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', ...env,
  });
  // eslint-disable-next-line global-require
  await require('../../bot/shared/config/model-settings').refresh();
  // eslint-disable-next-line global-require
  const { getClient } = require('../../bot/shared/services/llm-client');
  await getClient().chat.completions.create({ model: 'openai/gpt-4.1-mini', job: 'chat.intent', messages: [] });
  return mockState.events.find((e) => e.name === 'llm.job_override_config');
}

beforeEach(() => { mockState.events = []; mockState.rows = []; });
afterEach(() => { process.env = { ...OLD_ENV }; });

test('on Railway, the config event names the service, environment, deployment and replica', async () => {
  const ev = await callOnce({
    RAILWAY_SERVICE_NAME: 'sqs-worker', RAILWAY_ENVIRONMENT_NAME: 'sandbox',
    RAILWAY_DEPLOYMENT_ID: 'dep-123', RAILWAY_REPLICA_ID: 'rep-456',
  });
  expect(ev.data.process).toEqual(expect.objectContaining({
    service: 'sqs-worker', environment: 'sandbox', deployment: 'dep-123', replica: 'rep-456',
  }));
  expect(typeof ev.data.process.host).toBe('string');
  expect(ev.data.process.pid).toBe(process.pid);
});

test('anywhere else, it still names the host and pid, and invents nothing', async () => {
  const ev = await callOnce({});
  expect(Object.keys(ev.data.process).sort()).toEqual(['host', 'pid']);
});
