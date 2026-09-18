/**
 * bd-5rd2f — reading model settings must never be what stops the bot from starting.
 *
 * FOUND BY THE REAL SUITE, NOT BY MINE. The first cut of model-settings.js did
 * `require('./supabase')` at the top of the file. That module is the bot's cold-boot env gate:
 * with SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing it prints a banner and calls
 * `process.exit(78)`. Because vision.service.js now requires the settings reader, a service
 * that had never needed a database acquired a hard dependency on one AT IMPORT.
 *
 * My own tests did not catch it: they mock `../shared/config/supabase`, so the gate never ran.
 * `tests/services/vision.service.test.js` does not mock it, and died with
 * "process.exit called with 78" pointing straight at the new require. That is the whole reason
 * the house rule treats mocking a first-party module as a hazard.
 *
 * The contract this pins: settings are an ENHANCEMENT. No database means no overrides, which
 * means today's model, which is exactly what this job did before any of this existed. It must
 * never mean no bot.
 */

const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VISION_MODEL'];
let saved;

beforeEach(() => {
  jest.resetModules();
  saved = {};
  ENV.forEach((v) => { saved[v] = process.env[v]; delete process.env[v]; });
});

afterEach(() => {
  ENV.forEach((v) => {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  });
  jest.resetModules();
});

describe('bd-5rd2f — no database is not a boot failure', () => {
  it('loads the settings reader with no Supabase configuration at all', () => {
    expect(() => require('../shared/config/model-settings')).not.toThrow();
  });

  it('serves the empty config, which the registry reads as today', () => {
    const { currentConfig, configForRequest } = require('../shared/config/model-settings');
    expect(currentConfig()).toEqual({});
    expect(configForRequest()).toEqual({});
  });

  it('a refresh with no database reports empty instead of exiting', async () => {
    const { refresh } = require('../shared/config/model-settings');
    await expect(refresh()).resolves.toEqual({});
  });

  it('the piloted job still resolves to its normal model with no database', () => {
    const { resolveModelForJob } = require('../shared/config/model-registry');
    const { configForRequest } = require('../shared/config/model-settings');
    const resolved = resolveModelForJob('vision.analyse', { cfg: configForRequest() });
    expect(resolved.model).toBe('gpt-4.1-mini');
    expect(resolved.source).toBe('today');
  });
});
