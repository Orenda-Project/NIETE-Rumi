/**
 * Spend has to say WHICH FEATURE spent it. bd-9b58p.
 *
 * `model` alone answers "what got more expensive"; only `job` answers "what is costing us per
 * child", which is the question this workstream exists for. The chokepoint already receives the
 * job at getClientForModel(model, { job }) -- it just was not carrying it down to the record.
 *
 * The second test is the one that matters. Four jobs have a null frozen fallback on purpose
 * (lp.author, lp.fidelity, hcp.feedback, platform.default) and the wrapper used to return the
 * bare client for them. lp.author is the largest spender in this deployment, so attributing
 * everything except the biggest line would have looked fine on a dashboard and been wrong.
 */
const recorded = [];
jest.mock('../shared/utils/model-cost', () => ({
  recordModelCost: (model, response, startedAt, extra) => recorded.push({ model, extra }),
}));

const CREATED = [];
jest.mock('openai', () => function OpenAI() {
  return {
    chat: { completions: {
      create: async (params) => { CREATED.push(params); return { usage: { cost: 0.0001 }, choices: [] }; },
    } },
  };
});

const { getClientForModel } = require('../shared/services/llm-client');

beforeEach(() => { recorded.length = 0; CREATED.length = 0; });

describe('model spend is attributed to a job (bd-9b58p)', () => {
  test('a job WITH a frozen fallback records its name', async () => {
    const { client, model } = getClientForModel('google/gemini-2.5-flash', { job: 'quiz.transcript' });
    await client.chat.completions.create({ model, messages: [] });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].extra.job).toBe('quiz.transcript');
  });

  test('a job with NO frozen fallback still records its name', async () => {
    // lp.author is deliberately null in FALLBACK: it is already Anthropic and has no validated
    // OpenAI predecessor. That must not cost it its attribution.
    const { fallbackForJob } = require('../shared/config/model-registry');
    expect(fallbackForJob('lp.author')).toBeNull();

    const { client, model } = getClientForModel('anthropic/claude-sonnet-4', { job: 'lp.author' });
    await client.chat.completions.create({ model, messages: [] });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].extra.job).toBe('lp.author');
  });

  test('the job never reaches the vendor as a request field', async () => {
    const { client, model } = getClientForModel('google/gemini-2.5-flash', { job: 'quiz.transcript' });
    await client.chat.completions.create({ model, messages: [] });

    expect(CREATED).toHaveLength(1);
    expect(CREATED[0].job).toBeUndefined();
    expect(CREATED[0].fallbackModel).toBeUndefined();
  });

  test('...and neither does a NULL fallback, which truthiness would have left behind', async () => {
    // The case the test above cannot see. lp.author carries `fallbackModel: null`, and a
    // `if (params.fallbackModel)` strip is false for null -- so the key survived onto the
    // request. An unknown field on every lesson-plan authoring call, the largest spender
    // here, against a file whose own comment promises NOTHING is added to the request.
    // Both keys are therefore stripped on presence, not truthiness.
    const { client, model } = getClientForModel('anthropic/claude-sonnet-4', { job: 'lp.author' });
    await client.chat.completions.create({ model, messages: [] });

    expect(CREATED).toHaveLength(1);
    expect(Object.keys(CREATED[0])).not.toContain('fallbackModel');
    expect(Object.keys(CREATED[0])).not.toContain('job');
  });

  test('a caller that names no job behaves exactly as before', async () => {
    const { client, model } = getClientForModel('google/gemini-2.5-flash');
    await client.chat.completions.create({ model, messages: [] });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].extra && recorded[0].extra.job).toBeFalsy();
  });
});
