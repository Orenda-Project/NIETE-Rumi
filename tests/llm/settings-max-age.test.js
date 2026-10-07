/**
 * bd-gr4fy.11 — a settings answer older than two refresh periods moves nothing.
 *
 * `configForRequest()` serves the cache and refreshes behind it, so no request waits on the
 * table. Nothing bounded how old that cache could be. A process with no model call since before
 * a change served its next call from the old answer, however long ago it was read, and only the
 * call after that saw the table as it is.
 *
 * Seen in production, 7 Oct 2026: coaching.priorFeedback was taken off Haiku at 07:20:31Z;
 * a worker that had been quiet ran it on Haiku at 07:23:38Z, and the next model call in the same
 * flow, a tenth of a millisecond later, logged the new table. The kill switch is read the same
 * way, so it would have been missed the same way, once per quiet process, at any later time.
 *
 * Pinned here: past two refresh periods the call is treated as at boot, before the first read.
 * Nothing moves, the refresh starts, and the next call sees the table as it is now. A process
 * that calls at least once a refresh period is unaffected.
 */
const mockState = { rows: [], queryError: null, reads: 0, sent: [], events: [] };

jest.mock('openai', () => function OpenAI() {
  return {
    chat: {
      completions: {
        create: async (params) => {
          mockState.sent.push(params.model);
          return { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} };
        },
      },
    },
  };
});
jest.mock('@anthropic-ai/sdk', () => function Anthropic() { return { messages: { create: async () => ({}) } }; });
jest.mock('../../bot/shared/utils/model-cost', () => ({ recordModelCost: () => {} }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({
    select: () => ({
      in: async () => {
        mockState.reads += 1;
        return mockState.queryError
          ? { data: null, error: { message: mockState.queryError } }
          : { data: mockState.rows, error: null };
      },
    }),
  }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, data) => mockState.events.push({ name, data }),
  getCurrentCorrelationId: () => 'corr-1',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }), { virtual: true });

const OLD_ENV = { ...process.env };
const SITE_MODEL = 'openai/gpt-4.1-mini';
const MOVED_TO = 'openai/gpt-4o';
const perJob = (map) => ({ key: 'llm_per_job', value: map });
const killSwitch = { key: 'llm_kill_switch', value: true };

let now;
let settings;

/** Let a background refresh land. */
const settle = () => new Promise((r) => setImmediate(r));

function load() {
  jest.resetModules();
  delete process.env.LLM_JOB_MODELS;
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
  });
  // eslint-disable-next-line global-require
  settings = require('../../bot/shared/config/model-settings');
}

async function ask() {
  // eslint-disable-next-line global-require
  const { getClient } = require('../../bot/shared/services/llm-client');
  await getClient().chat.completions.create({ model: SITE_MODEL, job: 'chat.intent', messages: [{ role: 'user', content: 'hi' }] });
  return mockState.sent[mockState.sent.length - 1];
}

beforeEach(() => {
  mockState.rows = [];
  mockState.queryError = null;
  mockState.reads = 0;
  mockState.sent = [];
  mockState.events = [];
  now = 5_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  load();
});

afterEach(() => {
  Date.now.mockRestore();
  process.env = { ...OLD_ENV };
});

describe('model-settings: how old an answer may be and still move a job', () => {
  test('older than two refresh periods: the call that finds it moves nothing, and the refresh starts', async () => {
    mockState.rows = [perJob({ 'chat.intent': MOVED_TO })];
    await settings.refresh();
    expect(settings.configForRequest().perJob).toEqual({ 'chat.intent': MOVED_TO });

    now += 2 * settings.TTL_MS + 1;
    mockState.rows = [];
    const readsBefore = mockState.reads;
    expect(settings.configForRequest()).toEqual({});
    expect(mockState.reads).toBe(readsBefore + 1);
  });

  test('the call after that refresh lands sees the table as it is now', async () => {
    mockState.rows = [perJob({ 'chat.intent': MOVED_TO })];
    await settings.refresh();

    now += 3 * settings.TTL_MS;
    mockState.rows = [killSwitch, perJob({ 'chat.intent': MOVED_TO })];
    settings.configForRequest();
    await settle();
    expect(settings.configForRequest()).toEqual({ killSwitch: true, perJob: { 'chat.intent': MOVED_TO } });
  });

  test('between one and two refresh periods the cache is still served while it refreshes', async () => {
    mockState.rows = [perJob({ 'chat.intent': MOVED_TO })];
    await settings.refresh();

    now += Math.round(1.5 * settings.TTL_MS);
    mockState.rows = [];
    expect(settings.configForRequest().perJob).toEqual({ 'chat.intent': MOVED_TO });
  });

  test('a refresh that fails after a long silence still carries the last good answer forward', async () => {
    mockState.rows = [perJob({ 'chat.intent': MOVED_TO })];
    await settings.refresh();

    now += 3 * settings.TTL_MS;
    mockState.queryError = 'connection refused';
    expect(settings.configForRequest()).toEqual({});
    await settle();
    expect(settings.configForRequest().perJob).toEqual({ 'chat.intent': MOVED_TO });
  });

  test('isCurrent: false while too old, true again once the refresh lands, always true with no database', async () => {
    expect(settings.isCurrent()).toBe(false);
    await settings.refresh();
    expect(settings.isCurrent()).toBe(true);
    now += 2 * settings.TTL_MS + 1;
    expect(settings.isCurrent()).toBe(false);
    settings.configForRequest();
    await settle();
    expect(settings.isCurrent()).toBe(true);

    delete process.env.SUPABASE_URL;
    now += 10 * settings.TTL_MS;
    expect(settings.isCurrent()).toBe(true);
  });
});

describe('llm-client, end to end: a quiet process never applies a table it has not re-read', () => {
  test('the override was removed while the process was quiet: its next call runs on its own model', async () => {
    mockState.rows = [perJob({ 'chat.intent': MOVED_TO })];
    await settings.refresh();
    expect(await ask()).toBe(MOVED_TO);

    now += 3 * settings.TTL_MS;
    mockState.rows = [];
    expect(await ask()).toBe(SITE_MODEL);
    await settle();
    expect(await ask()).toBe(SITE_MODEL);
  });

  test('the kill switch went on while the process was quiet: its next call runs on its own model', async () => {
    mockState.rows = [perJob({ 'chat.intent': MOVED_TO })];
    await settings.refresh();
    expect(await ask()).toBe(MOVED_TO);

    now += 3 * settings.TTL_MS;
    mockState.rows = [killSwitch, perJob({ 'chat.intent': MOVED_TO })];
    expect(await ask()).toBe(SITE_MODEL);
    await settle();
    expect(await ask()).toBe(SITE_MODEL);
  });

  test('a job moved while the process was quiet moves from the call after the refresh', async () => {
    await settings.refresh();
    expect(await ask()).toBe(SITE_MODEL);

    now += 3 * settings.TTL_MS;
    mockState.rows = [perJob({ 'chat.intent': MOVED_TO })];
    expect(await ask()).toBe(SITE_MODEL);
    await settle();
    expect(await ask()).toBe(MOVED_TO);
  });

  test('the too-old answer is not reported as a configuration: the config events name only real tables', async () => {
    mockState.rows = [perJob({ 'chat.intent': MOVED_TO })];
    await settings.refresh();
    await ask();

    now += 3 * settings.TTL_MS;
    mockState.rows = [killSwitch, perJob({ 'chat.intent': MOVED_TO })];
    await ask();
    await settle();
    await ask();

    const configs = mockState.events.filter((e) => e.name === 'llm.job_override_config').map((e) => e.data);
    expect(configs.map((c) => [c.killSwitch, c.active])).toEqual([
      [false, { 'chat.intent': MOVED_TO }],
      [true, {}],
    ]);
  });
});
