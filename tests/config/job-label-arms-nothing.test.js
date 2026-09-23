/**
 * THE SAFETY CLAIM OF bd-jntcx, ASSERTED RATHER THAN ARGUED.
 *
 * Labelling 15 coaching call sites was sold as telemetry-only: spend gets a name, the failure
 * path does not change. That is only true because these sites pass `job` in the create params
 * of a PLAIN getClient() client, where `fallbackModel` resolves to null and the chokepoint
 * rethrows. If someone later moves one onto getClientForModel(model, { job }), or gives the
 * registry a frozen fallback for a telemetry-only name, the vendor swap silently switches on
 * and a teacher gets an answer from a model nobody validated for that job.
 *
 * So: the label attributes, and it arms nothing. Both halves, both directions.
 */
const mockRecorded = [];
jest.mock('../../bot/shared/utils/model-cost', () => ({
  recordModelCost: (model, response, startedAt, extra) => mockRecorded.push({ model, extra }),
}));

let mockAttempts = [];
jest.mock('openai', () => function OpenAI() {
  return {
    chat: { completions: {
      create: async (params) => {
        mockAttempts.push(params);
        if (params.__boom) { const e = new Error('rate limited'); e.status = 429; throw e; }
        return { usage: { cost: 0.0002 }, choices: [] };
      },
    } },
  };
});

const { getClient } = require('../../bot/shared/services/llm-client');
const { TELEMETRY_ONLY_JOBS, FALLBACK, JOBS } = require('../../bot/shared/config/model-registry');

beforeEach(() => { mockRecorded.length = 0; mockAttempts = []; });

describe('a telemetry-only job attributes spend (bd-jntcx)', () => {
  test('the job reaches the cost record', async () => {
    await getClient().chat.completions.create({
      model: 'openai/gpt-5-mini', job: 'coaching.pedagogy', messages: [],
    });
    expect(mockRecorded).toHaveLength(1);
    expect(mockRecorded[0].extra.job).toBe('coaching.pedagogy');
  });

  test('and never reaches the vendor as a request field', async () => {
    await getClient().chat.completions.create({
      model: 'openai/gpt-5-mini', job: 'coaching.pedagogy', messages: [],
    });
    expect(mockAttempts).toHaveLength(1);
    expect(mockAttempts[0].job).toBeUndefined();
    expect('job' in mockAttempts[0]).toBe(false);
  });
});

describe('a telemetry-only job arms NO fallback (bd-jntcx)', () => {
  test('a 429 rethrows instead of retrying on another vendor', async () => {
    await expect(getClient().chat.completions.create({
      model: 'openai/gpt-5-mini', job: 'coaching.pedagogy', messages: [], __boom: true,
    })).rejects.toThrow('rate limited');

    // ONE attempt. A second would mean a vendor swap this change never authorised.
    expect(mockAttempts).toHaveLength(1);
    expect(mockRecorded).toHaveLength(0);
  });

  test('no telemetry-only name has a frozen fallback, or is a routed job', () => {
    for (const job of TELEMETRY_ONLY_JOBS) {
      expect(FALLBACK[job]).toBeUndefined();
      expect(JOBS[job]).toBeUndefined();
    }
  });
});
