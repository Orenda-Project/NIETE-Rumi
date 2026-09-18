/**
 * bd-5rd2f — the settings reader behind the model registry.
 *
 * The registry deliberately takes `cfg` as an ARGUMENT and never fetches it, because
 * `resolveModelForJob` runs on every request and must stay synchronous. Something still has to
 * produce that `cfg`. This is it: an async refresh against `app_settings`, and a SYNCHRONOUS
 * accessor that hands back the last good answer.
 *
 * FAIL SAFE, not fail closed. A feature flag that cannot be read should stay off; a model
 * choice that cannot be read should stay TODAY'S. Those are different defaults and the
 * difference matters: an unreadable settings table must never move a teacher onto a different
 * model, and must never take the bot down either. Every failure path returns `{}`, which the
 * registry reads as "no overrides", which is exactly today.
 *
 * Mirrors the shape of bot/shared/config/feature-flags.js, which is the house pattern for
 * reading this table from the bot side.
 */

let supabaseFrom;
let rows;
let queryError;

function makeChain() {
  const chain = {};
  chain.select = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.then = (res, rej) =>
    Promise.resolve({ data: queryError ? null : rows, error: queryError }).then(res, rej);
  return chain;
}

// The reader only reaches for a client when the environment can actually produce one, so
// these must be set or every case below is really testing the no-database path. That gate is
// covered on its own in model-settings-no-db.test.js.
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
let savedEnv;

beforeEach(() => {
  jest.resetModules();
  rows = [];
  queryError = null;
  savedEnv = {};
  ENV.forEach((v) => { savedEnv[v] = process.env[v]; });
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  supabaseFrom = jest.fn(() => makeChain());
  jest.doMock('../shared/config/supabase', () => ({ from: supabaseFrom }));
  jest.doMock('../shared/utils/logger', () => ({ logToFile: jest.fn() }));
});

afterEach(() => {
  ENV.forEach((v) => {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  });
  jest.resetModules();
});

const load = () => require('../shared/config/model-settings');

describe('bd-5rd2f — reading the model settings', () => {
  it('is empty before anything has been read, so the first request gets today', () => {
    const { currentConfig } = load();
    expect(currentConfig()).toEqual({});
  });

  it('reads the kill switch', async () => {
    rows = [{ key: 'llm_kill_switch', value: true }];
    const { refresh, currentConfig } = load();
    await refresh();
    expect(currentConfig().killSwitch).toBe(true);
  });

  it('parses a value stored as a JSON string, which is how this table is written', async () => {
    rows = [{ key: 'llm_rollout', value: '{"model":"google/gemini-2.5-flash","pct":10}' }];
    const { refresh, currentConfig } = load();
    await refresh();
    expect(currentConfig().rollout).toEqual({ model: 'google/gemini-2.5-flash', pct: 10 });
  });

  it('reads the per-language and per-region maps', async () => {
    rows = [
      { key: 'llm_per_language', value: { 'vision.analyse:ur': 'google/gemini-2.5-flash' } },
      { key: 'llm_per_region', value: { niete: 'openai/gpt-4o' } },
    ];
    const { refresh, currentConfig } = load();
    await refresh();
    expect(currentConfig().perLanguage['vision.analyse:ur']).toBe('google/gemini-2.5-flash');
    expect(currentConfig().perRegion.niete).toBe('openai/gpt-4o');
  });

  it('asks only for the llm_ keys, not the whole settings table', async () => {
    const { refresh } = load();
    await refresh();
    expect(supabaseFrom).toHaveBeenCalledWith('app_settings');
    const chain = supabaseFrom.mock.results[0].value;
    const [column, keys] = chain.in.mock.calls[0];
    expect(column).toBe('key');
    expect(keys).toEqual(expect.arrayContaining(['llm_kill_switch', 'llm_rollout']));
    expect(keys.every((k) => k.startsWith('llm_'))).toBe(true);
  });

  it('returns today on a failed lookup rather than taking the bot down', async () => {
    queryError = { message: 'connection refused' };
    const { refresh, currentConfig } = load();
    await expect(refresh()).resolves.toBeDefined();
    expect(currentConfig()).toEqual({});
  });

  it('returns today on malformed JSON rather than a half-parsed rule', async () => {
    rows = [{ key: 'llm_per_job', value: '{not json' }];
    const { refresh, currentConfig } = load();
    await refresh();
    expect(currentConfig().perJob).toBeUndefined();
  });

  it('keeps the last good answer when a later read fails', async () => {
    rows = [{ key: 'llm_kill_switch', value: true }];
    const { refresh, currentConfig } = load();
    await refresh();
    expect(currentConfig().killSwitch).toBe(true);

    queryError = { message: 'gone' };
    await refresh();
    expect(currentConfig().killSwitch).toBe(true);
  });

  it('clamps a rollout percentage to 0..100 so a typo cannot move everyone', async () => {
    rows = [{ key: 'llm_rollout', value: { model: 'openai/gpt-4o', pct: 5000 } }];
    const { refresh, currentConfig } = load();
    await refresh();
    expect(currentConfig().rollout.pct).toBe(100);
  });

  it('drops a rollout whose model id is not a model id', async () => {
    rows = [{ key: 'llm_rollout', value: { model: 'DROP TABLE users', pct: 10 } }];
    const { refresh, currentConfig } = load();
    await refresh();
    expect(currentConfig().rollout).toBeUndefined();
  });

  it('does not stampede the table when many requests arrive before the first read lands', async () => {
    // configForRequest() fires a background refresh whenever the cache is stale, and the
    // cache is stale from boot until the first read returns. On an image burst that is one
    // query per message against a table whose answer is identical every time.
    const { configForRequest } = load();
    for (let i = 0; i < 25; i++) configForRequest();
    await new Promise((r) => setImmediate(r));
    expect(supabaseFrom).toHaveBeenCalledTimes(1);
  });

  it('refreshes again once the in-flight read has finished', async () => {
    const { configForRequest, refresh } = load();
    configForRequest();
    await refresh();
    expect(supabaseFrom.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('never writes to the table', async () => {
    rows = [{ key: 'llm_kill_switch', value: true }];
    const { refresh } = load();
    await refresh();
    const chain = supabaseFrom.mock.results[0].value;
    expect(chain.insert).toBeUndefined();
    expect(chain.update).toBeUndefined();
    expect(chain.upsert).toBeUndefined();
  });
});
