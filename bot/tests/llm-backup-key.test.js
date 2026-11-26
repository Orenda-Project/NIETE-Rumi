/**
 * A second OpenRouter key when the first one runs out of budget. bd-9xnyql.
 *
 * 25 Nov 2026, 05:05-05:44Z: the production OpenRouter key hit its spend cap and answered every
 * call with 403 "Key limit exceeded". About 150 coaching reports, assessment builds, own plans and
 * quiz digests failed in 40 minutes. The vendor fallback could not help: it retries ANOTHER MODEL
 * on the SAME key, and the key was the thing that was empty.
 *
 * So: when the key itself cannot spend (401 revoked, 402 no credit, 403 over its limit), the same
 * request is sent once more on OPENROUTER_API_KEY_FALLBACK. Same model, same request, other key.
 * Nothing changes when that variable is unset, which is every environment until it is set.
 */
const path = require('path');

describe('bd-9xnyql — a backup OpenRouter key when the first runs out of budget', () => {
  let calls;
  let logged;
  let failFor;

  const load = (env = {}) => {
    jest.resetModules();
    calls = [];
    logged = [];
    failFor = {};
    delete process.env.OPENROUTER_API_KEY_FALLBACK;
    Object.assign(process.env, {
      OPENROUTER_API_KEY: 'primary', LLM_PROVIDER: 'openrouter', LLM_FALLBACK_OFF: '', ...env,
    });
    jest.doMock('openai', () => class FakeOpenAI {
      constructor(config) {
        const key = config.apiKey;
        this.chat = { completions: { create: async (params) => {
          calls.push({ key, model: params.model });
          // A fresh error each time, as a real SDK throws: re-throwing one instance makes the
          // vendor fallback set it as its own cause, and Jest overflows printing the loop.
          const f = failFor[key];
          if (f) throw Object.assign(new Error(f.message), { status: f.status });
          return { model: params.model, usage: { prompt_tokens: 1, completion_tokens: 1 },
            choices: [{ message: { content: `ok from ${key}` }, finish_reason: 'stop' }] };
        } } };
      }
    });
    jest.doMock('@anthropic-ai/sdk', () => class FakeAnthropic {});
    jest.doMock('../shared/utils/structured-logger', () => ({
      logEvent: (event, payload) => logged.push({ event, payload }),
      logToFile: () => {}, logger: { info() {}, warn() {}, error() {} },
      getCurrentCorrelationId: () => 'test-correlation',
      runWithCorrelation: (id, fn) => fn(),
      generateCorrelationId: () => 'test-correlation',
    }));
    return require('../shared/services/llm-client');
  };
  afterEach(() => {
    jest.resetModules();
    delete process.env.OPENROUTER_API_KEY_FALLBACK;
    delete process.env.LLM_FALLBACK_OFF;
  });

  const err = (status, message) => Object.assign(new Error(message), { status });
  const ask = (client, extra = {}) =>
    client.chat.completions.create({ model: 'anthropic/claude-sonnet-5', messages: [], ...extra });

  it('sends the same request on the backup key when the first key is over its limit (the 25 Nov case)', async () => {
    const { getClient } = load({ OPENROUTER_API_KEY_FALLBACK: 'backup' });
    failFor.primary = err(403, 'Key limit exceeded (total limit). Manage it using https://openrouter.ai/settings/keys');
    const res = await ask(getClient());
    expect(calls).toEqual([
      { key: 'primary', model: 'anthropic/claude-sonnet-5' },
      { key: 'backup', model: 'anthropic/claude-sonnet-5' },
    ]);
    expect(res.choices[0].message.content).toBe('ok from backup');
    expect(res.usage.key_fallback).toBe(true);
  });

  it.each([[402, 'Insufficient credits'], [401, 'User not found.']])(
    'also moves to the backup key on %i (%s): that key cannot spend either',
    async (status, message) => {
      const { getClient } = load({ OPENROUTER_API_KEY_FALLBACK: 'backup' });
      failFor.primary = err(status, message);
      await ask(getClient());
      expect(calls.map((c) => c.key)).toEqual(['primary', 'backup']);
    },
  );

  it('says so in a queryable event', async () => {
    const { getClient } = load({ OPENROUTER_API_KEY_FALLBACK: 'backup' });
    failFor.primary = err(403, 'Key limit exceeded');
    await ask(getClient());
    const hit = logged.find((l) => l.event === 'llm.key_fallback');
    expect(hit).toBeDefined();
    expect(hit.payload).toMatchObject({ model: 'anthropic/claude-sonnet-5', status: 403 });
    expect(JSON.stringify(hit.payload)).not.toContain('backup'); // never the key itself
  });

  it('changes nothing when no backup key is set (every environment today)', async () => {
    const { getClient } = load();
    failFor.primary = err(403, 'Key limit exceeded');
    await expect(ask(getClient())).rejects.toThrow('Key limit exceeded');
    expect(calls.map((c) => c.key)).toEqual(['primary']);
  });

  it('does not move on a 403 that is not about money (a flagged input stays flagged)', async () => {
    const { getClient } = load({ OPENROUTER_API_KEY_FALLBACK: 'backup' });
    failFor.primary = err(403, 'Your chosen model requires moderation and your input was flagged');
    await expect(ask(getClient())).rejects.toThrow('flagged');
    expect(calls.map((c) => c.key)).toEqual(['primary']);
  });

  it('does not move on our own bad request or a supplier outage (the model fallback owns those)', async () => {
    const { getClient } = load({ OPENROUTER_API_KEY_FALLBACK: 'backup' });
    failFor.primary = err(400, 'invalid parameter');
    await expect(ask(getClient())).rejects.toThrow('invalid parameter');
    failFor.primary = err(503, 'upstream unavailable');
    await expect(ask(getClient())).rejects.toThrow('upstream unavailable');
    expect(calls.map((c) => c.key)).toEqual(['primary', 'primary']);
  });

  it('does not retry when the backup is the same key', async () => {
    const { getClient } = load({ OPENROUTER_API_KEY_FALLBACK: 'primary' });
    failFor.primary = err(403, 'Key limit exceeded');
    await expect(ask(getClient())).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('can be switched off with the existing fallback switch', async () => {
    const { getClient } = load({ OPENROUTER_API_KEY_FALLBACK: 'backup', LLM_FALLBACK_OFF: '1' });
    failFor.primary = err(403, 'Key limit exceeded');
    await expect(ask(getClient())).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('carries the first failure when the backup key fails too', async () => {
    const { getClient } = load({ OPENROUTER_API_KEY_FALLBACK: 'backup' });
    failFor.primary = err(403, 'Key limit exceeded');
    failFor.backup = err(402, 'Insufficient credits');
    const e = await ask(getClient()).catch((x) => x);
    expect(e.message).toContain('Insufficient credits');
    expect(e.message).toContain('Key limit exceeded');
    expect(e.cause.status).toBe(403);
  });

  it('then still tries the job\'s fallback model, on the backup key as well', async () => {
    // The order is key first, then model: the key that is empty is the likelier cause, and a
    // different model on the same empty key cannot answer.
    const { getClient } = load({ OPENROUTER_API_KEY_FALLBACK: 'backup' });
    failFor.primary = err(402, 'Insufficient credits');
    const res = await ask(getClient(), { fallbackModel: 'openai/gpt-4o' });
    expect(calls.map((c) => c.key)).toEqual(['primary', 'backup']);
    expect(res.choices[0].message.content).toBe('ok from backup');
  });

  it('covers the reflective-question ladder too, which builds its own OpenRouter client', async () => {
    load({ OPENROUTER_API_KEY_FALLBACK: 'backup' });
    jest.doMock('../shared/services/e2e-cassette', () => ({ mode: () => 'off' }));
    const { withBackupKey } = require('../shared/services/llm-backup-key');
    const OpenAI = require('openai');
    const client = withBackupKey(new OpenAI({ apiKey: 'primary' }), (apiKey) => new OpenAI({ apiKey }));
    failFor.primary = err(403, 'Key limit exceeded');
    const res = await client.chat.completions.create({ model: 'x/y', messages: [] });
    expect(res.choices[0].message.content).toBe('ok from backup');
    const src = require('fs').readFileSync(
      path.join(__dirname, '../shared/services/coaching/reflective-questions/llm-router.service.js'), 'utf8');
    expect(src).toMatch(/withBackupKey\(/);
  });
});
