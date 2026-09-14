/**
 * bd-dsr9l — a read that fails must back off like one that succeeds.
 *
 * The cache was stamped only on success. So after a failed read the cache stayed null,
 * `isStale()` stayed true forever, and `configForRequest()` started another read on every
 * single call. A database that is down therefore got one query per image message, which is
 * the opposite of what a struggling database needs.
 *
 * The single-flight guard did not help. It dedupes CONCURRENT calls, and an image queue is
 * sequential: each request finishes before the next arrives, so each one starts its own read.
 *
 * What is pinned here: a failure is CACHED, for the same TTL as a success, carrying the last
 * good config forward. The back-off is temporary, not permanent, or a blip at boot would
 * freeze the settings for the life of the process.
 */

let supabaseFrom;
let rows;
let queryError;
let now;

function makeChain() {
  const chain = {};
  chain.select = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.then = (res, rej) =>
    Promise.resolve({ data: queryError ? null : rows, error: queryError }).then(res, rej);
  return chain;
}

const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
let savedEnv;

/** Let requests arrive one after another, the way an image queue actually delivers them. */
async function sequentialRequests(configForRequest, n) {
  for (let i = 0; i < n; i++) {
    configForRequest();
    await new Promise((r) => setImmediate(r));
  }
}

beforeEach(() => {
  jest.resetModules();
  rows = [];
  queryError = null;
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  savedEnv = {};
  ENV.forEach((v) => { savedEnv[v] = process.env[v]; });
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  supabaseFrom = jest.fn(() => makeChain());
  jest.doMock('../shared/config/supabase', () => ({ from: supabaseFrom }));
  jest.doMock('../shared/utils/logger', () => ({ logToFile: jest.fn() }));
});

afterEach(() => {
  Date.now.mockRestore();
  ENV.forEach((v) => {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  });
  jest.resetModules();
});

describe('bd-dsr9l — a dead database is asked once, not once per request', () => {
  it('makes one query for twenty sequential requests while the read is failing', async () => {
    queryError = { message: 'db is down' };
    const { configForRequest } = require('../shared/config/model-settings');

    await sequentialRequests(configForRequest, 20);

    expect(supabaseFrom).toHaveBeenCalledTimes(1);
  });

  it('makes no query at all for twenty sequential requests with no database configured', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { configForRequest, isStale } = require('../shared/config/model-settings');

    await sequentialRequests(configForRequest, 20);

    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(isStale()).toBe(false);
  });

  it('tries again once the back-off has expired, so a blip is not permanent', async () => {
    queryError = { message: 'db is down' };
    const { configForRequest, TTL_MS } = require('../shared/config/model-settings');

    await sequentialRequests(configForRequest, 5);
    expect(supabaseFrom).toHaveBeenCalledTimes(1);

    now += TTL_MS + 1;
    queryError = null;
    rows = [{ key: 'llm_kill_switch', value: true }];
    await sequentialRequests(configForRequest, 1);

    expect(supabaseFrom).toHaveBeenCalledTimes(2);
  });

  it('serves the last good config through a failure rather than reverting to empty', async () => {
    rows = [{ key: 'llm_per_job', value: { 'vision.analyse': 'openai/gpt-4o' } }];
    const { refresh, configForRequest } = require('../shared/config/model-settings');
    await refresh();
    expect(configForRequest().perJob['vision.analyse']).toBe('openai/gpt-4o');

    now += 61_000;
    queryError = { message: 'db is down' };
    await sequentialRequests(configForRequest, 10);

    expect(configForRequest().perJob['vision.analyse']).toBe('openai/gpt-4o');
    // one for the successful read, one for the failed one, and nothing for the nine after it
    expect(supabaseFrom).toHaveBeenCalledTimes(2);
  });

  it('still resolves the piloted job to today while the database is unreachable', async () => {
    queryError = { message: 'db is down' };
    const { configForRequest } = require('../shared/config/model-settings');
    const { resolveModelForJob } = require('../shared/config/model-registry');

    await sequentialRequests(configForRequest, 3);

    const resolved = resolveModelForJob('vision.analyse', { cfg: configForRequest() });
    expect(resolved.model).toBe('gpt-4.1-mini');
    expect(resolved.source).toBe('today');
  });
});
