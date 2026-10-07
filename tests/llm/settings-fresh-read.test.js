/**
 * bd-gr4fy.14 — a call that finds the settings stale and not current reads them first, briefly.
 *
 * Since bd-gr4fy.11 a cache older than two refresh periods moves nothing, which keeps the kill switch exact. But
 * the call that found it ran on its own model even when the override was still in force: in a process that had
 * been quiet, or busy on one call longer than two minutes (found by the quiz evaluation, 7 Oct 2026), and on a fresh
 * process's first call. Safe, but it quietly shrinks a moved job's coverage and skews what its watch measures.
 *
 * Pinned here: such a call waits for one settings read, bounded by LLM_SETTINGS_FRESH_WAIT_MS, then plans with
 * the table as it is (override or kill switch alike). A read that does not land in time leaves the call on its own
 * model. An outage costs one bounded wait per read, not one per call: a read that fails is stamped (bd-dsr9l), and a
 * read that hangs is waited out once, the calls behind it going straight on until it settles. Fresh settings: no wait,
 * no read.
 */
const mockState = { rows: [], queryError: null, hang: false, release: null, reads: 0, sent: [] };

jest.mock('openai', () => function OpenAI() {
  return { chat: { completions: { create: async (params) => {
    mockState.sent.push(params.model);
    return { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} };
  } } } };
});
jest.mock('@anthropic-ai/sdk', () => function Anthropic() { return { messages: { create: async () => ({}) } }; });
jest.mock('../../bot/shared/utils/model-cost', () => ({ recordModelCost: () => {} }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: () => {
    mockState.reads += 1;
    if (mockState.hang) return new Promise((resolve) => { mockState.release = () => resolve({ data: mockState.rows, error: null }); });
    return Promise.resolve(mockState.queryError
      ? { data: null, error: { message: mockState.queryError } }
      : { data: mockState.rows, error: null });
  } }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: () => {}, getCurrentCorrelationId: () => 'corr-1' }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }), { virtual: true });

const OLD_ENV = { ...process.env };
const SITE_MODEL = 'openai/gpt-4.1-mini';
const MOVED_TO = 'openai/gpt-4o';
const perJob = { key: 'llm_per_job', value: { 'chat.intent': MOVED_TO } };
const killSwitch = { key: 'llm_kill_switch', value: true };

let now;
let settings;

function load() {
  jest.resetModules();
  delete process.env.LLM_JOB_MODELS;
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
    LLM_SETTINGS_FRESH_WAIT_MS: '50',
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
  Object.assign(mockState, { rows: [], queryError: null, hang: false, release: null, reads: 0, sent: [] });
  now = 5_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  load();
});
afterEach(() => {
  Date.now.mockRestore();
  process.env = { ...OLD_ENV };
});

describe('a stale, not-current settings cache is read once (bounded) before a job is planned (bd-gr4fy.14)', () => {
  test('a quiet process with the override still in force: its next call uses the override', async () => {
    mockState.rows = [perJob];
    await settings.refresh();
    expect(await ask()).toBe(MOVED_TO);
    now += 3 * settings.TTL_MS;
    expect(await ask()).toBe(MOVED_TO);
  });

  test('a fresh process with an override in the table: its FIRST call uses it', async () => {
    mockState.rows = [perJob];
    expect(await ask()).toBe(MOVED_TO);
  });

  test('the kill switch flipped while the process was quiet still wins on that first call', async () => {
    mockState.rows = [perJob];
    await settings.refresh();
    expect(await ask()).toBe(MOVED_TO);
    now += 3 * settings.TTL_MS;
    mockState.rows = [killSwitch, perJob];
    expect(await ask()).toBe(SITE_MODEL);
  });

  test('a settings read that hangs: the call goes on its own model after the bound, not later', async () => {
    Date.now.mockRestore();
    jest.spyOn(Date, 'now').mockImplementation(() => now); // the cache clock stays fixed; the bound runs on real timers
    mockState.rows = [perJob];
    mockState.hang = true;
    const t0 = process.hrtime.bigint();
    expect(await ask()).toBe(SITE_MODEL);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(ms).toBeLessThan(1000);
  });

  test('a read that hangs is waited for ONCE: the calls after the bound do not wait for it again', async () => {
    Date.now.mockRestore();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    process.env.LLM_SETTINGS_FRESH_WAIT_MS = '200';
    mockState.rows = [perJob];
    mockState.hang = true;
    expect(await ask()).toBe(SITE_MODEL); // this one waits the bound
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 3; i++) expect(await ask()).toBe(SITE_MODEL);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(ms).toBeLessThan(150); // three more waits on the same read would take 600 ms
    expect(mockState.reads).toBe(1);
  });

  test('a LATER read is waited for again: the pass covers the one read that hung, not every read after it', async () => {
    Date.now.mockRestore();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockState.hang = true;
    expect(await ask()).toBe(SITE_MODEL); // waits the bound on the first read, which hangs
    mockState.hang = false;
    mockState.release(); // the first read lands at last: no override in the table then
    await new Promise((resolve) => setImmediate(resolve));
    now += 3 * settings.TTL_MS; // quiet again, long enough to be too old
    mockState.rows = [perJob];
    expect(await ask()).toBe(MOVED_TO); // the second read is waited for, and moves the job
    expect(mockState.reads).toBe(2);
  });

  test('database down: one read and at most one wait per refresh period, not one per call', async () => {
    mockState.queryError = 'connection refused';
    for (let i = 0; i < 5; i++) expect(await ask()).toBe(SITE_MODEL);
    expect(mockState.reads).toBe(1);
  });

  test('fresh settings: no extra read', async () => {
    mockState.rows = [perJob];
    await settings.refresh();
    for (let i = 0; i < 3; i++) expect(await ask()).toBe(MOVED_TO);
    expect(mockState.reads).toBe(1);
  });
});
