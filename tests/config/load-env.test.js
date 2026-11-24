/**
 * bd-bodycs — a local .env must never leak into a process Railway already configured.
 *
 * `railway run --environment sandbox node probe.js` from a NIETE-Rumi checkout gives the
 * process its sandbox variables, then `require('dotenv').config()` in the Supabase client
 * read the checkout's .env and filled every key Railway had not set. On 2026-11-06 that
 * put 11 production values into a sandbox probe. dotenv never overrides a set key, so the
 * damage is the keys the environment leaves unset — "non-overriding" alone does not fix it.
 *
 * The rule: when Railway supplied the environment (a deploy, or `railway run`), the .env
 * file is not read at all. A plain local run (no Railway markers) still reads it, as before.
 */

const RAILWAY_MARKERS = [
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_PROJECT_ID',
];

describe('loadEnv (bd-bodycs)', () => {
  const loadEnv = (opts) => require('../../bot/shared/config/load-env').loadEnv(opts);

  test.each(RAILWAY_MARKERS)('does not read .env when %s is set', (marker) => {
    const dotenv = { config: jest.fn() };
    const result = loadEnv({ env: { [marker]: 'sandbox' }, dotenv });
    expect(dotenv.config).not.toHaveBeenCalled();
    expect(result).toEqual({ loaded: false, reason: 'railway' });
  });

  test('reads .env on a plain local run', () => {
    const dotenv = { config: jest.fn() };
    const result = loadEnv({ env: {}, dotenv });
    expect(dotenv.config).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ loaded: true });
  });

  test('an empty marker is not a Railway run', () => {
    const dotenv = { config: jest.fn() };
    loadEnv({ env: { RAILWAY_ENVIRONMENT_NAME: '' }, dotenv });
    expect(dotenv.config).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  'bot/shared/config/supabase.js',
  'bot/shared/config/supabase-replica.js',
  'bot/shared/utils/constants.js',
])('%s under railway run (bd-bodycs)', (file) => {
  const saved = process.env.RAILWAY_ENVIRONMENT_NAME;
  afterEach(() => {
    if (saved === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = saved;
  });

  test('loading it does not read .env', () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = 'sandbox';
    jest.isolateModules(() => {
      const dotenv = require('dotenv');
      dotenv.config.mockClear();
      require(`../../${file}`);
      expect(dotenv.config).not.toHaveBeenCalled();
    });
  });

  test('a plain local run still reads .env', () => {
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    jest.isolateModules(() => {
      const dotenv = require('dotenv');
      dotenv.config.mockClear();
      require(`../../${file}`);
      expect(dotenv.config).toHaveBeenCalled();
    });
  });
});
