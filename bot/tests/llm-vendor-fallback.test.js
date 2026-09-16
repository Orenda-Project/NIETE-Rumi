/**
 * Keep OpenAI behind the other vendors. bd-4uw7n.
 *
 * The last item on the original brief, and the only one that was still only a design. Neither
 * codebase had it as a general property: the main bot has a ladder inside one coaching feature,
 * and this fork has one in the direct Anthropic lane that retries the SAME model by a different
 * route. That is a route fallback. "Anthropic is down, use OpenAI" existed nowhere.
 *
 * Built at getClient(), which 33 of the 41 files that call a model already go through.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not retry everything. A 400 is our bug and retrying
 * it elsewhere just breaks twice; a timeout is already the SDK's business. It fires on the two
 * cases a second supplier actually answers: the account cannot spend, and the supplier is down.
 */
const path = require('path');

describe('bd-4uw7n — OpenAI stays behind the other vendors', () => {
  let attempts;
  let logged;
  let failWith;

  const load = (env = {}) => {
    jest.resetModules();
    attempts = [];
    logged = [];
    failWith = null;
    Object.assign(process.env, {
      OPENROUTER_API_KEY: 'k', LLM_PROVIDER: 'openrouter',
      LLM_FALLBACK_OFF: '', ...env,
    });
    jest.doMock('openai', () => class FakeOpenAI {
      constructor() {
        this.chat = { completions: { create: async (params) => {
          attempts.push(params.model);
          if (failWith && attempts.length === 1) throw failWith;
          return { model: params.model, usage: { prompt_tokens: 1, completion_tokens: 1 },
                   choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] };
        } } };
      }
    });
    jest.doMock('@anthropic-ai/sdk', () => class FakeAnthropic {});
    jest.doMock('../shared/utils/structured-logger', () => ({
      logEvent: (event, payload) => logged.push({ event, payload }),
      logToFile: () => {}, logger: { info() {}, warn() {}, error() {} },
      // utils/logger reads this off structured-logger; omitting it made the real logToFile
      // throw inside the fallback path and look like a code fault.
      getCurrentCorrelationId: () => 'test-correlation',
      runWithCorrelation: (id, fn) => fn(),
      generateCorrelationId: () => 'test-correlation',
    }));
    return require('../shared/services/llm-client');
  };
  afterEach(() => { jest.resetModules(); delete process.env.LLM_FALLBACK_OFF; });

  const err = (status, message = 'boom') => Object.assign(new Error(message), { status });

  it('falls back to OpenAI when the account cannot spend', async () => {
    const { getClient } = load();
    failWith = err(402, 'insufficient credits');
    const res = await getClient().chat.completions.create({ model: 'anthropic/claude-sonnet-5', messages: [] });
    expect(attempts).toEqual(['anthropic/claude-sonnet-5', 'openai/gpt-4o']);
    expect(res.usage.provider_fallback).toBe(true);
  });

  it('falls back when the supplier is down', async () => {
    const { getClient } = load();
    failWith = err(503, 'upstream unavailable');
    await getClient().chat.completions.create({ model: 'google/gemini-2.5-flash', messages: [] });
    expect(attempts[1]).toBe('openai/gpt-4o');
  });

  it('does NOT fall back on our own bad request', async () => {
    const { getClient } = load();
    failWith = err(400, 'invalid parameter');
    await expect(getClient().chat.completions.create({ model: 'anthropic/claude-sonnet-5', messages: [] }))
      .rejects.toThrow('invalid parameter');
    expect(attempts).toEqual(['anthropic/claude-sonnet-5']);
  });

  it('never falls back from OpenAI to itself, which would be a loop', async () => {
    const { getClient } = load();
    failWith = err(503);
    await expect(getClient().chat.completions.create({ model: 'openai/gpt-4o', messages: [] }))
      .rejects.toThrow();
    expect(attempts).toEqual(['openai/gpt-4o']);
  });

  it('says so in a queryable event, because a silent vendor swap is worse than none', async () => {
    const { getClient } = load();
    failWith = err(402, 'insufficient credits');
    await getClient().chat.completions.create({ model: 'anthropic/claude-sonnet-5', messages: [] });
    const hit = logged.find((l) => l.event === 'llm.vendor_fallback');
    expect(hit).toBeDefined();
    expect(hit.payload.from).toBe('anthropic/claude-sonnet-5');
    expect(hit.payload.to).toBe('openai/gpt-4o');
    expect(hit.payload.status).toBe(402);
  });

  it('can be switched off without a deploy', async () => {
    const { getClient } = load({ LLM_FALLBACK_OFF: '1' });
    failWith = err(503);
    await expect(getClient().chat.completions.create({ model: 'anthropic/claude-sonnet-5', messages: [] }))
      .rejects.toThrow();
    expect(attempts).toEqual(['anthropic/claude-sonnet-5']);
  });

  it('carries the first failure when both suppliers fail', async () => {
    jest.resetModules();
    attempts = []; logged = [];
    process.env.OPENROUTER_API_KEY = 'k'; process.env.LLM_PROVIDER = 'openrouter';
    jest.doMock('openai', () => class FakeOpenAI {
      constructor() {
        this.chat = { completions: { create: async (p) => {
          attempts.push(p.model);
          throw Object.assign(new Error(attempts.length === 1 ? 'no credit' : 'openai down'),
                              { status: attempts.length === 1 ? 402 : 503 });
        } } };
      }
    });
    jest.doMock('@anthropic-ai/sdk', () => class FakeAnthropic {});
    jest.doMock('../shared/utils/structured-logger', () => ({
      logEvent: () => {}, logToFile: () => {}, logger: { info() {}, warn() {}, error() {} },
      getCurrentCorrelationId: () => 'test-correlation',
      runWithCorrelation: (id, fn) => fn(),
      generateCorrelationId: () => 'test-correlation',
    }));
    const { getClient } = require('../shared/services/llm-client');
    // Whoever reads this needs the FIRST failure as much as the second: "OpenAI is down" alone
    // sends the next engineer to the wrong supplier.
    await expect(getClient().chat.completions.create({ model: 'anthropic/claude-sonnet-5', messages: [] }))
      .rejects.toThrow(/no credit/);
    expect(attempts).toEqual(['anthropic/claude-sonnet-5', 'openai/gpt-4o']);
  });

  it('records the cost of the attempt that actually answered', async () => {
    const { getClient } = load();
    failWith = err(402);
    await getClient().chat.completions.create({ model: 'anthropic/claude-sonnet-5', messages: [] });
    const costs = logged.filter((l) => l.event === 'api.cost.incurred');
    expect(costs.length).toBe(1);
    expect(costs[0].payload.model).toBe('openai/gpt-4o');
  });
});

/**
 * bd-4uw7n, found in review — the two ladders meet, and the deeper one must win the label.
 *
 * The direct-Anthropic lane's own fallback calls getClient(), which is now the WRAPPED client.
 * So a call can descend three tiers: direct Anthropic, then the same model via OpenRouter, then
 * OpenAI. That is good, and it was accidental rather than designed, so it needs pinning.
 *
 * What is NOT good is what the direct lane does afterwards. It stamps
 * `provider_fallback_to: <the OpenRouter Anthropic model>` onto the response unconditionally,
 * which overwrites the wrapper's own stamp. A lesson actually authored by OpenAI would be
 * reported as authored by Claude. That lane's own comment says why that matters: "THE LESSON
 * MUST SAY WHERE IT WAS AUTHORED... would make the whole point of this lane unmeasurable".
 */
describe('bd-4uw7n — when both ladders fire, the answer still says who wrote it', () => {
  it('does not let the outer lane relabel an answer the inner ladder got from OpenAI', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../shared/services/llm-client.js'), 'utf8');
    const lane = /function buildDirectLaneClient[\s\S]*?\n\}/.exec(src)[0];
    // The stamp must not be unconditional: a fallback_to already on the response is the
    // deeper, truer one and has to survive. So the lane has to READ what is there before it
    // writes, and prefer it.
    expect(lane).toMatch(/res\.usage\.provider_fallback_to/);
    expect(lane).toMatch(/provider_fallback_to:\s*already\s*\|\|\s*to/);
    // and the route it went through is still recorded, just not as the author
    expect(lane).toMatch(/provider_fallback_via/);
  });
});
