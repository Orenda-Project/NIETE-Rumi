/**
 * The repo-root test tree (tests/**, run by `node tests/run.js` with tests/jest.config.js) must load the
 * same no-live-services guard as bot/: bot/tests/setup-loopback.js. Its moduleNameMapper fakes Supabase,
 * pg, dotenv, axios and the AWS SDKs, but `openai`, `@anthropic-ai/sdk` and `ioredis` resolve to the real
 * packages, so without the guard an unmocked call from a root-tree test would dial the real host.
 */
const LOOPBACK = /^(https?|redis|postgres):\/\/([^@/]*@)?127\.0\.0\.1:9(\/|$)/;

const failure = (promise) => promise.then(() => null, (err) => err);
const blockedCause = (err) => {
  for (let e = err; e; e = e.cause) if (e.egressBlocked) return e;
  return null;
};

describe('the root test tree never reaches a live service', () => {
  test('tests/jest.config.js loads the guard', () => {
    const config = require('./jest.config');
    expect(config.setupFiles).toContain('<rootDir>/bot/tests/setup-loopback.js');
  });

  test('LLM SDK base URLs are loopback', () => {
    expect(process.env.OPENAI_BASE_URL).toMatch(LOOPBACK);
    expect(process.env.ANTHROPIC_BASE_URL).toMatch(LOOPBACK);
  });

  test('the faked supabase-js of this tree (moduleNameMapper) is left alone: any host may be built', () => {
    const { createClient } = require('@supabase/supabase-js');
    expect(() => createClient('https://test.supabase.co', 'k')).not.toThrow();
  });

  test('the real openai SDK cannot reach its public host', async () => {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: 'test-loopback', baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: 5000 });
    const err = await failure(client.models.list());
    expect(err).not.toBeNull();
    expect(Boolean(blockedCause(err))).toBe(true);
  });

  test('the real anthropic SDK cannot reach its public host', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: 'test-loopback', baseURL: 'https://api.anthropic.com', maxRetries: 0, timeout: 5000 });
    const err = await failure(client.models.list());
    expect(err).not.toBeNull();
    expect(Boolean(blockedCause(err))).toBe(true);
  });

  test('the real ioredis cannot reach a non-loopback host', async () => {
    const Redis = require('ioredis');
    const redis = new Redis({ host: 'cache.vendor.example.org', port: 6379, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
    // ioredis reports the socket's error on its 'error' event and rejects connect() with its own
    // "Connection is closed", so the guard's mark is read from the event.
    const socketError = new Promise((resolve) => redis.once('error', resolve));
    await failure(redis.connect());
    const err = await socketError;
    redis.disconnect();
    expect(Boolean(blockedCause(err))).toBe(true);
  });
});
