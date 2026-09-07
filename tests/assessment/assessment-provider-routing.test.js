/**
 * A broken OpenRouter provider looks exactly like a broken model.
 *
 * Measured 7 Sep on Gemma 4 31B: the SAME prompt, four calls, provider being
 * the only variable —
 *
 *   ModelRun    3 completion tokens   0 questions   body: {}
 *   CoreWeave   1613                 15
 *   Friendli    1678                 15
 *   auto        1636                 15
 *
 * ModelRun returns `{}` or `{"seen":":{"}` with finish_reason "stop" and bills
 * the full prompt. It failed on prompts that succeed elsewhere, including one
 * that had already succeeded in the same run, so it is not a size or content
 * effect. Three of fourteen eval papers died this way and were recorded as
 * NO_QUESTIONS — a model verdict for an infrastructure fault.
 *
 * Routing therefore has to be part of the request, not left to chance, and the
 * reason has to survive in the code so nobody "cleans up" the pin later.
 */
const path = require('path');
const SERVICE_PATH = path.join(__dirname, '../../bot/shared/services/assessment/assessment-generation.service.js');
const fs = require('fs');
const SOURCE = fs.readFileSync(SERVICE_PATH, 'utf8');

describe('the generation request pins its providers', () => {
  let captured;

  beforeEach(() => {
    jest.resetModules();
    captured = null;
    jest.doMock('../../bot/shared/services/openrouter.client', () => ({
      getClient: () => ({
        chat: { completions: { create: async (body) => { captured = body; throw new Error('stop here'); } } },
      }),
    }), { virtual: true });
  });

  test('a known-bad provider is named in the source, with its evidence', () => {
    expect(SOURCE).toMatch(/ModelRun/);
  });

  test('the allow-list is configurable without a code change', () => {
    expect(SOURCE).toMatch(/ASSESSMENT_GEN_PROVIDERS/);
  });

  test('fallbacks stay ON — a pin that blocks every provider is worse', () => {
    expect(SOURCE).toMatch(/allow_fallbacks:\s*true/);
  });

  test('the request carries a provider order', () => {
    const Generation = require('../../bot/shared/services/assessment/assessment-generation.service');
    expect(Generation.PROVIDERS.length).toBeGreaterThan(1);
    expect(Generation.PROVIDERS).not.toContain('ModelRun');
  });
});
