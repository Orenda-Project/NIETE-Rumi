/**
 * Every model call through the shared client records what it cost. bd-8t362.
 *
 * Nobody could say what this deployment spends. 44 files make a model call, none recorded a
 * cost, and the registry holds no rate table.
 *
 * WHY THERE IS STILL NO RATE TABLE HERE, AND SHOULD NOT BE. This deployment calls OpenRouter,
 * which resells four vendors and takes a margin, so a table of vendor list prices would be
 * confidently wrong. OpenRouter will instead report what it ACTUALLY charged if the request
 * asks for it, and the direct Anthropic lane already computes a real price in the facade,
 * cache multipliers and all. So the rule is: record what the vendor says it cost, and record
 * nothing rather than a guess. An invented number is worse than an admitted gap, because
 * nobody re-checks a figure that looks plausible.
 *
 * The one place. `createLLMClient` already wraps `chat.completions.create` to auto-prefix model
 * names, and 33 of the 41 files that call a model go through it. Extending that wrapper covers
 * all of them at once, and every call site added later gets it for free. Eight files construct
 * a vendor SDK directly and are NOT covered; they are named in the PR rather than assumed away.
 */
const path = require('path');

describe('bd-8t362 — the shared client records what a call cost', () => {
  let created;
  let logged;

  const load = (env = {}) => {
    jest.resetModules();
    created = [];
    logged = [];
    Object.assign(process.env, { OPENROUTER_API_KEY: 'k', ...env });
    jest.doMock('openai', () => class FakeOpenAI {
      constructor() {
        this.chat = { completions: { create: async (params) => {
          created.push(params);
          return {
            model: params.model,
            usage: params.__fakeUsage || { prompt_tokens: 100, completion_tokens: 20, cost: 0.0042 },
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          };
        } } };
      }
    });
    jest.doMock('@anthropic-ai/sdk', () => class FakeAnthropic {});
    jest.doMock('../shared/utils/structured-logger', () => ({
      logEvent: (event, payload) => logged.push({ event, payload }),
      logToFile: () => {},
      logger: { info() {}, warn() {}, error() {} },
    }));
    return require('../shared/services/llm-client');
  };

  afterEach(() => { jest.resetModules(); });

  it('changes nothing about the request', async () => {
    // An earlier draft sent `usage: {include:true}` to ask OpenRouter for its accounting,
    // until lp612-author's own note pointed out that cost is already on every response
    // without it, verified against the live API. Changing a request for no benefit is the
    // risk this workstream exists to avoid, so this asserts the request is untouched apart
    // from the model prefix the wrapper was already applying.
    const { getClient } = load({ LLM_PROVIDER: 'openrouter' });
    const sent = { model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'hi' }] };
    await getClient().chat.completions.create({ ...sent });
    expect(created[0]).toEqual(sent);
  });

  it('still auto-prefixes the model, which this wrapper was already doing', async () => {
    const { getClient } = load({ LLM_PROVIDER: 'openrouter' });
    await getClient().chat.completions.create({ model: 'gpt-4o', messages: [] });
    expect(created[0].model).toBe('openai/gpt-4o');
  });

  it('records the cost the vendor reported, not one we worked out', async () => {
    const { getClient } = load({ LLM_PROVIDER: 'openrouter' });
    await getClient().chat.completions.create({ model: 'openai/gpt-4o', messages: [] });
    const hit = logged.find((l) => l.event === 'api.cost.incurred');
    expect(hit).toBeDefined();
    expect(hit.payload.estimatedCostUsd).toBeCloseTo(0.0042, 9);
    expect(hit.payload.tokensIn).toBe(100);
    expect(hit.payload.tokensOut).toBe(20);
    expect(hit.payload.model).toBe('openai/gpt-4o');
  });

  it('records tokens but NO cost when the vendor reports none', async () => {
    const { getClient } = load({ LLM_PROVIDER: 'openrouter' });
    await getClient().chat.completions.create({
      model: 'openai/gpt-4o', messages: [],
      __fakeUsage: { prompt_tokens: 7, completion_tokens: 3 },
    });
    const hit = logged.find((l) => l.event === 'api.cost.incurred');
    expect(hit.payload.tokensIn).toBe(7);
    expect(hit.payload.estimatedCostUsd).toBeNull();
  });

  it('never invents a price for a model nobody priced', async () => {
    const { getClient } = load({ LLM_PROVIDER: 'openrouter' });
    await getClient().chat.completions.create({
      model: 'deepseek/deepseek-v3.2', messages: [],
      __fakeUsage: { prompt_tokens: 1000, completion_tokens: 1000 },
    });
    expect(logged.find((l) => l.event === 'api.cost.incurred').payload.estimatedCostUsd).toBeNull();
  });

  it('leaves the direct-OpenAI provider path entirely alone', async () => {
    const { getClient } = load({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' });
    await getClient().chat.completions.create({ model: 'gpt-4o', messages: [] });
    expect(created[0]).toEqual({ model: 'gpt-4o', messages: [] });
  });

  it('records the direct Anthropic lane, which bypassed this wrapper entirely', () => {
    // That lane returns through the facade, which has already computed a real price. It was
    // recording nothing while its own OpenRouter fallback recorded, so the job with the
    // largest spend here was the one job invisible.
    const src = require('fs').readFileSync(
      path.join(__dirname, '../shared/services/llm-client.js'), 'utf8');
    const lane = /function buildDirectLaneClient[\s\S]*?\n\}/.exec(src);
    expect(lane).not.toBeNull();
    expect(lane[0]).toMatch(/recordModelCost\(/);
    expect(lane[0]).toMatch(/lane: 'anthropic-direct'/);
  });

  it('a recording failure cannot fail the call it is measuring', async () => {
    const { getClient } = load({ LLM_PROVIDER: 'openrouter' });
    const src = require('fs').readFileSync(
      path.join(__dirname, '../shared/services/llm-client.js'), 'utf8');
    expect(src).toMatch(/try\s*\{[\s\S]*?recordModelCost[\s\S]*?catch/);
    const res = await getClient().chat.completions.create({ model: 'openai/gpt-4o', messages: [] });
    expect(res.choices[0].message.content).toBe('ok');
  });
});
